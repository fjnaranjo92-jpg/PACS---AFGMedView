import { mutation, query, internalMutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.js";

// Admin credentials
const ADMIN_USER = "AFGMEDVIEW";
const ADMIN_PASS = "ADMIN1992";

function generateToken(): string {
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 36).toString(36)
  ).join("");
}

function generateOtp(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ─── Login step 1: verify credentials, generate OTP ─────────────────────────

export const adminLoginStep1 = mutation({
  args: {
    username: v.string(),
    password: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ otpSent: boolean }> => {
    if (args.username !== ADMIN_USER || args.password !== ADMIN_PASS) {
      await ctx.db.insert("adminAccessLog", {
        attemptedAt: new Date().toISOString(),
        username: args.username,
        result: "failed_credentials",
        userAgent: args.userAgent,
      });
      throw new ConvexError({ message: "Credenciales incorrectas", code: "FORBIDDEN" });
    }

    // Generate 6-digit OTP valid for 10 minutes
    const code = generateOtp();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();

    await ctx.db.insert("adminOtpCodes", {
      code,
      createdAt: now.toISOString(),
      expiresAt,
      used: false,
    });

    // Get admin email from settings
    const emailSetting = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "admin_email"))
      .first();
    const adminEmail = emailSetting?.value ?? "afgmedview@gmail.com";

    // Send OTP email asynchronously
    await ctx.scheduler.runAfter(0, internal.adminEmail.sendAdminOtp, {
      code,
      adminEmail,
    });

    return { otpSent: true };
  },
});

// ─── Login step 2: verify OTP, create session ────────────────────────────────

export const adminLoginStep2 = mutation({
  args: {
    code: v.string(),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ token: string }> => {
    const now = new Date();
    const otpRecord = await ctx.db
      .query("adminOtpCodes")
      .withIndex("by_code", (q) => q.eq("code", args.code))
      .first();

    if (
      !otpRecord ||
      otpRecord.used ||
      new Date(otpRecord.expiresAt) < now
    ) {
      await ctx.db.insert("adminAccessLog", {
        attemptedAt: now.toISOString(),
        username: ADMIN_USER,
        result: "failed_otp",
        userAgent: args.userAgent,
      });
      throw new ConvexError({ message: "Código inválido o expirado", code: "FORBIDDEN" });
    }

    // Mark OTP as used
    await ctx.db.patch(otpRecord._id, { used: true });

    // Create session
    const token = generateToken();
    await ctx.db.insert("adminSessions", {
      token,
      createdAt: now.toISOString(),
    });

    // Audit: success
    await ctx.db.insert("adminAccessLog", {
      attemptedAt: now.toISOString(),
      username: ADMIN_USER,
      result: "success",
      userAgent: args.userAgent,
    });

    return { token };
  },
});

// Legacy login — kept for backward compat, now calls step1+step2 is replaced
export const adminLogin = mutation({
  args: { username: v.string(), password: v.string() },
  handler: async (ctx, args): Promise<{ token: string }> => {
    if (args.username !== ADMIN_USER || args.password !== ADMIN_PASS) {
      throw new ConvexError({ message: "Credenciales incorrectas", code: "FORBIDDEN" });
    }
    const token = generateToken();
    await ctx.db.insert("adminSessions", {
      token,
      createdAt: new Date().toISOString(),
    });
    return { token };
  },
});

// ─── Auth guard ──────────────────────────────────────────────────────────────

async function requireAdmin(ctx: QueryCtx | MutationCtx, token: string) {
  const session = await ctx.db
    .query("adminSessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();
  if (!session) throw new ConvexError({ message: "No autorizado", code: "FORBIDDEN" });
  return session;
}

// ─── Users ───────────────────────────────────────────────────────────────────

export const getAllUsers = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<Array<{
    _id: string;
    name?: string;
    lastName?: string;
    email?: string;
    country?: string;
    tokenIdentifier: string;
    _creationTime: number;
    subscription?: {
      status: string;
      planName: string;
      priceUsd: number;
      startDate?: string;
      expiryDate?: string;
    } | null;
    license?: {
      licenseId: string;
      planType: string;
      status: string;
      priceUsd: number;
      startDate: string;
      expiryDate?: string;
      activatedAt?: string;
      licenseCode?: string;
      studiesUsed?: number;
      maxStudies?: number;
    } | null;
  }>> => {
    await requireAdmin(ctx, args.token);
    const users = await ctx.db.query("users").collect();
    const result = await Promise.all(
      users.map(async (u) => {
        const sub = await ctx.db
          .query("subscriptions")
          .withIndex("by_user", (q) => q.eq("userId", u._id))
          .first();
        const lic = await ctx.db
          .query("licenses")
          .withIndex("by_user", (q) => q.eq("userId", u._id))
          .first();
        return {
          _id: u._id,
          name: u.name,
          lastName: u.lastName,
          email: u.email,
          country: u.country,
          tokenIdentifier: u.tokenIdentifier,
          _creationTime: u._creationTime,
          subscription: sub
            ? {
                status: sub.status,
                planName: sub.planName,
                priceUsd: sub.priceUsd,
                startDate: sub.startDate,
                expiryDate: sub.expiryDate,
              }
            : null,
          license: lic
            ? {
                licenseId: lic._id,
                planType: lic.planType,
                status: lic.status,
                priceUsd: lic.priceUsd,
                startDate: lic.startDate,
                expiryDate: lic.expiryDate,
                activatedAt: lic.activatedAt,
                licenseCode: lic.licenseCode,
                studiesUsed: lic.studiesUsed,
                maxStudies: lic.maxStudies,
              }
            : null,
        };
      })
    );
    return result;
  },
});

// ─── Assign license to any user ──────────────────────────────────────────────

export const adminAssignLicense = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    planType: v.union(v.literal("trial"), v.literal("premium"), v.literal("pro")),
    priceUsd: v.optional(v.number()),
    paymentReference: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);

    const getSetting = async (key: string, fallback: string) => {
      const s = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", key)).first();
      return s?.value ?? fallback;
    };

    const now = new Date();

    let expiryDate: string | undefined;
    let studiesUsed: number | undefined;
    let maxStudies: number | undefined;
    let updatesExpiryDate: string | undefined;
    let maxDevices: number | undefined;

    if (args.planType === "trial") {
      const trialDays = parseInt(await getSetting("license_trial_days", "3"), 10);
      const trialMaxStudies = parseInt(await getSetting("license_trial_max_studies", "10"), 10);
      expiryDate = new Date(now.getTime() + trialDays * 24 * 60 * 60 * 1000).toISOString();
      studiesUsed = 0;
      maxStudies = trialMaxStudies;
    } else {
      const updMonths = parseInt(await getSetting(`license_${args.planType}_updates_months`, args.planType === "pro" ? "24" : "12"), 10);
      const devs = parseInt(await getSetting(`license_${args.planType}_max_devices`, args.planType === "pro" ? "2" : "1"), 10);
      const expDate = new Date(now);
      expDate.setMonth(expDate.getMonth() + updMonths);
      updatesExpiryDate = expDate.toISOString();
      maxDevices = devs;
    }

    const existing = await ctx.db
      .query("licenses")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    const licenseData = {
      userId: args.userId,
      planType: args.planType,
      status: args.planType === "trial" ? ("trial" as const) : ("active" as const),
      priceUsd: args.priceUsd ?? 0,
      startDate: now.toISOString(),
      ...(expiryDate && { expiryDate }),
      ...(updatesExpiryDate && { updatesExpiryDate }),
      ...(maxDevices !== undefined && { maxDevices }),
      ...(studiesUsed !== undefined && { studiesUsed }),
      ...(maxStudies !== undefined && { maxStudies }),
      activatedAt: now.toISOString(),
      ...(args.paymentReference && { paymentReference: args.paymentReference }),
      ...(args.notes && { notes: args.notes }),
    };

    if (existing) {
      await ctx.db.patch(existing._id, licenseData);
    } else {
      await ctx.db.insert("licenses", licenseData);
    }

    // Marcar solicitud pendiente como aprobada si existe
    if (args.planType !== "trial") {
      const request = await ctx.db
        .query("licenseRequests")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .first();
      if (request && request.status === "pending") {
        await ctx.db.patch(request._id, { status: "approved" });
      }
    }
  },
});

// ─── Revoke license by userId ─────────────────────────────────────────────────

export const adminRevokeUserLicense = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    status: v.union(v.literal("suspended"), v.literal("expired")),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const lic = await ctx.db
      .query("licenses")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (!lic) throw new ConvexError({ message: "El usuario no tiene licencia", code: "NOT_FOUND" });
    await ctx.db.patch(lic._id, { status: args.status });
  },
});

// ─── Update subscription status ──────────────────────────────────────────────

export const adminUpdateSubscription = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    status: v.union(
      v.literal("active"),
      v.literal("inactive"),
      v.literal("expired"),
      v.literal("pending")
    ),
    expiryDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (sub) {
      await ctx.db.patch(sub._id, {
        status: args.status,
        ...(args.expiryDate && { expiryDate: args.expiryDate }),
      });
    } else {
      await ctx.db.insert("subscriptions", {
        userId: args.userId,
        status: args.status,
        planName: "Plan Inicial",
        priceUsd: 3.99,
        startDate: new Date().toISOString(),
        expiryDate: args.expiryDate ?? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
    }
  },
});

// ─── Mark payment confirmed ───────────────────────────────────────────────────

export const adminConfirmPayment = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    paymentReference: v.string(),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const sub = await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    const now = new Date().toISOString();
    const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    if (sub) {
      await ctx.db.patch(sub._id, {
        status: "active",
        startDate: now,
        expiryDate: expiry,
        paymentReference: args.paymentReference,
      });
    } else {
      await ctx.db.insert("subscriptions", {
        userId: args.userId,
        status: "active",
        planName: "Plan Inicial",
        priceUsd: 3.99,
        startDate: now,
        expiryDate: expiry,
        paymentReference: args.paymentReference,
      });
    }
  },
});

// ─── Settings ────────────────────────────────────────────────────────────────

export const adminGetSettings = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<Array<{ key: string; value: string }>> => {
    await requireAdmin(ctx, args.token);
    const all = await ctx.db.query("settings").collect();
    return all.map((s) => ({ key: s.key, value: s.value }));
  },
});

export const adminSetSetting = mutation({
  args: { token: v.string(), key: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const existing = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value });
    } else {
      await ctx.db.insert("settings", { key: args.key, value: args.value });
    }
  },
});

// ─── Stats ────────────────────────────────────────────────────────────────────

export const adminGetStats = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{
    totalUsers: number;
    activeSubscriptions: number;
    pendingSubscriptions: number;
    inactiveSubscriptions: number;
  }> => {
    await requireAdmin(ctx, args.token);
    const users = await ctx.db.query("users").collect();
    const subs = await ctx.db.query("subscriptions").collect();
    return {
      totalUsers: users.length,
      activeSubscriptions: subs.filter((s) => s.status === "active").length,
      pendingSubscriptions: subs.filter((s) => s.status === "pending").length,
      inactiveSubscriptions: subs.filter((s) => s.status === "inactive" || s.status === "expired").length,
    };
  },
});

// ─── Access Log ──────────────────────────────────────────────────────────────

export const adminGetAccessLog = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<Array<{
    _id: string;
    attemptedAt: string;
    username: string;
    result: string;
    userAgent?: string;
  }>> => {
    await requireAdmin(ctx, args.token);
    const logs = await ctx.db
      .query("adminAccessLog")
      .withIndex("by_attempted_at")
      .order("desc")
      .take(100);
    return logs.map((l) => ({
      _id: l._id,
      attemptedAt: l.attemptedAt,
      username: l.username,
      result: l.result,
      userAgent: l.userAgent,
    }));
  },
});

// ─── Payment Info (datos bancarios / QR) ────────────────────────────────────

export const adminGetPaymentInfo = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<Array<{ key: string; value: string }>> => {
    await requireAdmin(ctx, args.token);
    const items = await ctx.db.query("paymentInfo").collect();
    return items.map((i) => ({ key: i.key, value: i.value }));
  },
});

export const adminSetPaymentInfo = mutation({
  args: { token: v.string(), key: v.string(), value: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const existing = await ctx.db
      .query("paymentInfo")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { value: args.value });
    } else {
      await ctx.db.insert("paymentInfo", { key: args.key, value: args.value });
    }
  },
});

// Public getter for payment info (used in Activar Licencia page)
export const getPaymentInfo = query({
  args: {},
  handler: async (ctx): Promise<Record<string, string>> => {
    const items = await ctx.db.query("paymentInfo").collect();
    const result: Record<string, string> = {};
    for (const item of items) {
      result[item.key] = item.value;
    }
    return result;
  },
});

// ─── Billing / Voucher management ────────────────────────────────────────────

export const adminGetBillingList = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<Array<{
    _id: string;
    userId: string;
    userName: string;
    userEmail: string;
    planType: string;
    status: string;
    fileName: string;
    uploadedAt: string;
    invoiceNumber?: string;
    invoiceIssuedAt?: string;
    invoiceStatus?: string;
    billingData?: {
      razonSocial: string;
      identificacion: string;
      emailFactura: string;
      nombres?: string;
      apellidos?: string;
      ruc?: string;
      ciudad: string;
      pais: string;
    } | null;
  }>> => {
    await requireAdmin(ctx, args.token);
    const vouchers = await ctx.db.query("paymentVouchers").order("desc").take(200);
    return await Promise.all(vouchers.map(async (v) => {
      const user = await ctx.db.get(v.userId) as Doc<"users"> | null;
      const billing = await ctx.db
        .query("billingData")
        .withIndex("by_user", (q) => q.eq("userId", v.userId))
        .first();
      return {
        _id: v._id,
        userId: v.userId,
        userName: user?.name ?? "—",
        userEmail: user?.email ?? "—",
        planType: v.planType,
        status: v.status,
        fileName: v.fileName,
        uploadedAt: v.uploadedAt,
        invoiceNumber: v.invoiceNumber,
        invoiceIssuedAt: v.invoiceIssuedAt,
        invoiceStatus: v.invoiceStatus,
        billingData: billing ? {
          razonSocial: billing.razonSocial,
          identificacion: billing.identificacion,
          emailFactura: billing.emailFactura,
          nombres: billing.nombres,
          apellidos: billing.apellidos,
          ruc: billing.ruc,
          ciudad: billing.ciudad,
          pais: billing.pais,
        } : null,
      };
    }));
  },
});

export const adminUpdateVoucher = mutation({
  args: {
    token: v.string(),
    voucherId: v.id("paymentVouchers"),
    status: v.optional(v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected"))),
    invoiceNumber: v.optional(v.string()),
    invoiceStatus: v.optional(v.union(v.literal("pending"), v.literal("issued"), v.literal("not_required"))),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.token);
    const patch: Record<string, unknown> = {};
    if (args.status !== undefined) patch.status = args.status;
    if (args.invoiceNumber !== undefined) {
      patch.invoiceNumber = args.invoiceNumber;
      patch.invoiceIssuedAt = new Date().toISOString();
    }
    if (args.invoiceStatus !== undefined) patch.invoiceStatus = args.invoiceStatus;
    if (args.notes !== undefined) patch.notes = args.notes;
    await ctx.db.patch(args.voucherId, patch);

    // Si se aprueba: activar o crear licencia automáticamente
    if (args.status === "approved") {
      const voucher = await ctx.db.get(args.voucherId);
      if (voucher) {
        const existing = await ctx.db
          .query("licenses")
          .withIndex("by_user", (q) => q.eq("userId", voucher.userId))
          .first();
        type LicensePlan = "trial" | "personal" | "premium" | "pro" | "paciente";
        const planType = voucher.planType as LicensePlan;
        if (existing) {
          await ctx.db.patch(existing._id, {
            planType,
            status: "active",
            activatedAt: new Date().toISOString(),
          });
        } else {
          await ctx.db.insert("licenses", {
            userId: voucher.userId,
            planType,
            status: "active",
            startDate: new Date().toISOString(),
            activatedAt: new Date().toISOString(),
            priceUsd: 0,
          });
        }
      }
    }
  },
});
