import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel.d.ts";
import type { QueryCtx, MutationCtx } from "./_generated/server";

// ─── Helper: validate admin session ──────────────────────────────────────────

async function requireAdmin(ctx: QueryCtx | MutationCtx, token: string): Promise<void> {
  const session = await ctx.db
    .query("adminSessions")
    .withIndex("by_token", (q) => q.eq("token", token))
    .first();
  if (!session) throw new ConvexError({ message: "No autorizado", code: "FORBIDDEN" });
}

// ─── Types ───────────────────────────────────────────────────────────────────

type LicensePlanType = "trial" | "personal" | "premium" | "pro" | "paciente" | "empresa";

type AccountRow = {
  _id: Id<"users">;
  _creationTime: number;
  name?: string;
  lastName?: string;
  email?: string;
  country?: string;
  tokenIdentifier: string;
  role?: string;
  companyId?: Id<"companies">;
  companyStatus?: string;
  accountType: "individual" | "enterprise";
  company: { name: string; planName: string; status: string; _id: Id<"companies"> } | null;
  license: {
    _id: Id<"licenses">;
    planType: string;
    status: string;
    priceUsd: number;
    startDate: string;
    expiryDate?: string;
    activatedAt?: string;
    licenseCode?: string;
  } | null;
  effectivePlan: string;
  effectiveStatus: string;
};

// ─── Queries ─────────────────────────────────────────────────────────────────

export const getAll = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<AccountRow[]> => {
    await requireAdmin(ctx, args.token);

    const users = await ctx.db.query("users").collect();
    const results: AccountRow[] = [];

    for (const user of users) {
      // Get license
      const licenseDoc = await ctx.db
        .query("licenses")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .first();

      // Get company
      let companyDoc: Doc<"companies"> | null = null;
      if (user.companyId) {
        companyDoc = await ctx.db.get(user.companyId);
      }

      // Derive accountType
      const accountType: "individual" | "enterprise" = user.companyId ? "enterprise" : "individual";

      // Derive effectivePlan
      let effectivePlan = "demo";
      if (licenseDoc) {
        effectivePlan = licenseDoc.planType;
      } else if (companyDoc) {
        effectivePlan = companyDoc.planName;
      }

      // Derive effectiveStatus
      let effectiveStatus = "pending";
      if (licenseDoc) {
        effectiveStatus = licenseDoc.status;
      } else if (companyDoc) {
        // Map company status to account status
        if (companyDoc.status === "active" || companyDoc.status === "trial") {
          effectiveStatus = "active";
        } else if (companyDoc.status === "suspended") {
          effectiveStatus = "suspended";
        } else {
          effectiveStatus = companyDoc.status;
        }
      }

      const license = licenseDoc
        ? {
            _id: licenseDoc._id,
            planType: licenseDoc.planType,
            status: licenseDoc.status,
            priceUsd: licenseDoc.priceUsd,
            startDate: licenseDoc.startDate,
            expiryDate: licenseDoc.expiryDate,
            activatedAt: licenseDoc.activatedAt,
            licenseCode: licenseDoc.licenseCode,
          }
        : null;

      const company = companyDoc
        ? {
            _id: companyDoc._id,
            name: companyDoc.name,
            planName: companyDoc.planName,
            status: companyDoc.status,
          }
        : null;

      results.push({
        _id: user._id,
        _creationTime: user._creationTime,
        name: user.name,
        lastName: user.lastName,
        email: user.email,
        country: user.country,
        tokenIdentifier: user.tokenIdentifier,
        role: user.role,
        companyId: user.companyId,
        companyStatus: user.companyStatus,
        accountType,
        company,
        license,
        effectivePlan,
        effectiveStatus,
      });
    }

    return results;
  },
});

export const getAccountHistory = query({
  args: { token: v.string(), userId: v.id("users") },
  handler: async (ctx, args): Promise<Doc<"accountHistory">[]> => {
    await requireAdmin(ctx, args.token);

    const history = await ctx.db
      .query("accountHistory")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    // Sort descending by changedAt
    return history.sort((a, b) => b.changedAt.localeCompare(a.changedAt));
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

export const changePlan = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    newPlan: v.string(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    await requireAdmin(ctx, args.token);

    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError({ message: "Usuario no encontrado", code: "NOT_FOUND" });

    const existingLicense = await ctx.db
      .query("licenses")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    const now = new Date().toISOString();
    const previousPlan = existingLicense?.planType ?? "demo";

    // Map incoming plan name to license planType
    const planMapping: Record<string, LicensePlanType> = {
      demo:     "trial",
      trial:    "trial",
      paciente: "paciente",
      personal: "personal",
      premium:  "premium",
      pro:      "pro",
      lifetime: "pro",
      empresa:  "empresa",
    };

    const mappedPlan: LicensePlanType = planMapping[args.newPlan] ?? "trial";

    if (existingLicense) {
      await ctx.db.patch(existingLicense._id, {
        planType: mappedPlan,
        status: "active",
        activatedAt: now,
        ...(args.notes ? { notes: args.notes } : {}),
      });
    } else {
      // Create new license
      await ctx.db.insert("licenses", {
        userId: args.userId,
        planType: mappedPlan,
        status: "active",
        priceUsd: 0,
        startDate: now,
        activatedAt: now,
        ...(args.notes ? { notes: args.notes } : {}),
      });
    }

    // Obtener nombre del administrador que realiza el cambio
    const identity = await ctx.auth.getUserIdentity();
    const adminName = identity?.name ?? "Super Admin";

    // Record in account history
    await ctx.db.insert("accountHistory", {
      userId: args.userId,
      changedBy: adminName,
      changedAt: now,
      action: "plan_changed",
      previousPlan,
      newPlan: args.newPlan,
      notes: args.notes,
    });
  },
});

export const suspendAccount = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    await requireAdmin(ctx, args.token);

    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError({ message: "Usuario no encontrado", code: "NOT_FOUND" });

    // Suspend license if exists
    const license = await ctx.db
      .query("licenses")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (license) {
      await ctx.db.patch(license._id, { status: "suspended" });
    }

    // Suspend company if user belongs to one
    if (user.companyId) {
      await ctx.db.patch(user.companyId, { status: "suspended" });
    }

    const now = new Date().toISOString();

    // Record in account history
    await ctx.db.insert("accountHistory", {
      userId: args.userId,
      changedBy: "Super Admin",
      changedAt: now,
      action: "suspended",
      previousStatus: license?.status ?? "unknown",
      newStatus: "suspended",
      notes: args.notes,
    });
  },
});

export const activateAccount = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    await requireAdmin(ctx, args.token);

    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError({ message: "Usuario no encontrado", code: "NOT_FOUND" });

    // Activate license if exists
    const license = await ctx.db
      .query("licenses")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (license) {
      await ctx.db.patch(license._id, { status: "active" });
    }

    // Activate company if user belongs to one
    if (user.companyId) {
      await ctx.db.patch(user.companyId, { status: "active" });
    }

    const now = new Date().toISOString();

    // Record in account history
    await ctx.db.insert("accountHistory", {
      userId: args.userId,
      changedBy: "Super Admin",
      changedAt: now,
      action: "activated",
      previousStatus: license?.status ?? "unknown",
      newStatus: "active",
      notes: args.notes,
    });
  },
});

export const convertToIndividual = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    await requireAdmin(ctx, args.token);

    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError({ message: "Usuario no encontrado", code: "NOT_FOUND" });

    if (!user.companyId) {
      throw new ConvexError({
        message: "El usuario ya es una cuenta individual",
        code: "CONFLICT",
      });
    }

    const now = new Date().toISOString();
    const previousCompanyId = user.companyId;

    // Remove from company — revert role and clear companyId
    await ctx.db.patch(args.userId, {
      companyId: undefined,
      role: "independent",
      companyStatus: undefined,
    });

    // Downgrade license to demo/trial
    const license = await ctx.db
      .query("licenses")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (license) {
      await ctx.db.patch(license._id, {
        planType: "trial",
        status: "active",
        activatedAt: now,
        ...(args.notes ? { notes: args.notes } : {}),
      });
    } else {
      await ctx.db.insert("licenses", {
        userId: args.userId,
        planType: "trial",
        status: "active",
        priceUsd: 0,
        startDate: now,
        activatedAt: now,
        ...(args.notes ? { notes: args.notes } : {}),
      });
    }

    // Check if company still has other users; if the company is now empty, mark it inactive
    const remainingUsers = await ctx.db
      .query("users")
      .withIndex("by_company", (q) => q.eq("companyId", previousCompanyId))
      .take(1);

    if (remainingUsers.length === 0) {
      await ctx.db.patch(previousCompanyId, { status: "inactive", updatedAt: now });
    }

    // Record in account history
    await ctx.db.insert("accountHistory", {
      userId: args.userId,
      changedBy: "Super Admin",
      changedAt: now,
      action: "converted_to_individual",
      previousType: "enterprise",
      newType: "individual",
      notes: args.notes,
    });
  },
});

export const convertToEnterprise = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    companyName: v.string(),
    planName: v.optional(v.string()),
    maxUsers: v.optional(v.number()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    await requireAdmin(ctx, args.token);

    const user = await ctx.db.get(args.userId);
    if (!user) throw new ConvexError({ message: "Usuario no encontrado", code: "NOT_FOUND" });

    if (user.companyId) {
      throw new ConvexError({
        message: "El usuario ya pertenece a una empresa",
        code: "CONFLICT",
      });
    }

    const now = new Date().toISOString();

    // Create new company
    const companyId = await ctx.db.insert("companies", {
      name: args.companyName,
      adminEmail: user.email ?? "",
      planName: args.planName ?? "empresa",
      status: "active",
      maxUsers: args.maxUsers ?? 5,
      createdAt: now,
      updatedAt: now,
    });

    // Update user to enterprise
    await ctx.db.patch(args.userId, {
      companyId,
      role: "company_admin",
      companyStatus: "active",
    });

    // Record in account history
    await ctx.db.insert("accountHistory", {
      userId: args.userId,
      changedBy: "Super Admin",
      changedAt: now,
      action: "converted_to_enterprise",
      previousType: "individual",
      newType: "enterprise",
      notes: args.notes,
    });
  },
});
