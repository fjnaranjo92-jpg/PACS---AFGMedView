/**
 * Backend de licencias MedView — Sistema Comercial v2.
 * Módulo completamente independiente. No modifica subscriptions.ts ni otros módulos existentes.
 *
 * Planes:
 *  demo        → Gratis, hasta 3 conversiones, acceso completo a herramientas para demostración
 *  paciente    → USD 5.99/mes, básico sin herramientas PRO
 *  pro         → USD 149.99/mes, acceso ilimitado y todas las herramientas
 *  personalizado → cotización, módulos configurables por admin
 *
 * Claves de settings usadas:
 *  license_demo_max_conversions → "3"
 *  license_paciente_price       → "5.99"
 *  license_pro_price            → "149.99"
 *  license_lifetime_price       → "2499"
 *  license_pro_max_devices      → "2"
 */

import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel.d.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function getSetting(ctx: QueryCtx | MutationCtx, key: string, fallback: string): Promise<string> {
  const s = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  return s?.value ?? fallback;
}

async function setSetting(ctx: MutationCtx, key: string, value: string): Promise<void> {
  const s = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", key))
    .first();
  if (s) {
    await ctx.db.patch(s._id, { value });
  } else {
    await ctx.db.insert("settings", { key, value });
  }
}

async function getUser(ctx: QueryCtx | MutationCtx, tokenIdentifier: string) {
  return ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", tokenIdentifier))
    .unique();
}

async function requireUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ message: "No autenticado", code: "UNAUTHENTICATED" });
  const user = await getUser(ctx, identity.tokenIdentifier);
  if (!user) throw new ConvexError({ message: "Usuario no encontrado", code: "NOT_FOUND" });
  return user;
}

function addDays(date: Date, days: number): string {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

// ─── Tipos de retorno ─────────────────────────────────────────────────────────

type PlanPricing = {
  promoPrice: number;
  normalPrice: number;
  promoMax: number;
  promoSold: number;
  promoActive: boolean;
  currentPrice: number;
  promoRemaining: number;
};

type CommercialConfig = {
  // DEMO
  demoMaxConversions: number;
  // PACIENTE
  paciente: { price: number };
  // PRO
  pro: PlanPricing & { maxDevices: number };
  // PERSONALIZADO (módulos y precios)
  personalizado: {
    modules: Array<{ key: string; name: string; monthlyPrice: number; annualPrice: number }>;
    implementationBase: number;
  };
  // LIFETIME
  lifetimePrice: number;
  // Legacy (kept for admin compatibility)
  trialDays: number;
  trialMaxStudies: number;
  premium: PlanPricing & { maxDevices: number };
};

// ─── Query: Configuración comercial pública ───────────────────────────────────

export const getCommercialConfig = query({
  args: {},
  handler: async (ctx): Promise<CommercialConfig> => {
    const [
      demoMaxConv,
      pacientePrice,
      proPromo,
      proNormal,
      proPromoMax,
      proPromoSold,
      proDevices,
      lifetimePrice,
      // Legacy
      trialDays,
      trialMaxStudies,
      premPromo,
      premNormal,
      premPromoMax,
      premPromoSold,
    ] = await Promise.all([
      getSetting(ctx, "license_demo_max_conversions", "3"),
      getSetting(ctx, "license_paciente_price", "5.99"),
      getSetting(ctx, "license_pro_promo_price", "149.99"),
      getSetting(ctx, "license_pro_normal_price", "149.99"),
      getSetting(ctx, "license_pro_promo_max", "0"),
      getSetting(ctx, "license_pro_promo_sold", "0"),
      getSetting(ctx, "license_pro_max_devices", "2"),
      getSetting(ctx, "license_lifetime_price", "2499"),
      getSetting(ctx, "license_trial_days", "3"),
      getSetting(ctx, "license_trial_max_studies", "10"),
      getSetting(ctx, "license_premium_promo_price", "59"),
      getSetting(ctx, "license_premium_normal_price", "69"),
      getSetting(ctx, "license_premium_promo_max", "10"),
      getSetting(ctx, "license_premium_promo_sold", "0"),
    ]);

    const proSold = parseInt(proPromoSold, 10);
    const proMax = parseInt(proPromoMax, 10);
    const proPromoActive = proMax > 0 && proSold < proMax;

    const premSold = parseInt(premPromoSold, 10);
    const premMax = parseInt(premPromoMax, 10);
    const premPromoActive = premMax > 0 && premSold < premMax;

    return {
      demoMaxConversions: parseInt(demoMaxConv, 10),
      paciente: {
        price: parseFloat(pacientePrice),
      },
      pro: {
        promoPrice: parseFloat(proPromo),
        normalPrice: parseFloat(proNormal),
        promoMax: proMax,
        promoSold: proSold,
        promoActive: proPromoActive,
        currentPrice: proPromoActive ? parseFloat(proPromo) : parseFloat(proNormal),
        promoRemaining: Math.max(0, proMax - proSold),
        maxDevices: parseInt(proDevices, 10),
      },
      personalizado: {
        modules: [
          { key: "viewer", name: "Visualizador DICOM Completo", monthlyPrice: 29.99, annualPrice: 299.99 },
          { key: "conversion", name: "Conversión DICOM (JPG/MP4)", monthlyPrice: 19.99, annualPrice: 199.99 },
          { key: "measurements", name: "Herramientas de Medición", monthlyPrice: 39.99, annualPrice: 399.99 },
          { key: "roi", name: "Herramientas ROI", monthlyPrice: 29.99, annualPrice: 299.99 },
          { key: "volume", name: "Análisis de Volumen", monthlyPrice: 49.99, annualPrice: 499.99 },
          { key: "histogram", name: "Histograma y Estadísticas", monthlyPrice: 19.99, annualPrice: 199.99 },
          { key: "compare", name: "Comparación de Estudios", monthlyPrice: 29.99, annualPrice: 299.99 },
          { key: "ai", name: "Módulo IA (próximamente)", monthlyPrice: 79.99, annualPrice: 799.99 },
        ],
        implementationBase: 299,
      },
      lifetimePrice: parseFloat(lifetimePrice),
      // Legacy
      trialDays: parseInt(trialDays, 10),
      trialMaxStudies: parseInt(trialMaxStudies, 10),
      premium: {
        promoPrice: parseFloat(premPromo),
        normalPrice: parseFloat(premNormal),
        promoMax: premMax,
        promoSold: premSold,
        promoActive: premPromoActive,
        currentPrice: premPromoActive ? parseFloat(premPromo) : parseFloat(premNormal),
        promoRemaining: Math.max(0, premMax - premSold),
        maxDevices: 1,
      },
    };
  },
});

// ─── Query: Mi licencia activa ────────────────────────────────────────────────

export const getMyLicense = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await getUser(ctx, identity.tokenIdentifier);
    if (!user) return null;
    return ctx.db
      .query("licenses")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
  },
});

// ─── Mutation: Activar período DEMO ───────────────────────────────────────────

export const activateDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);

    // Verificar que no tenga ya una licencia
    const existing = await ctx.db
      .query("licenses")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (existing) throw new ConvexError({ message: "Ya tiene una licencia activa o período DEMO.", code: "CONFLICT" });

    const demoMaxConversions = parseInt(await getSetting(ctx, "license_demo_max_conversions", "3"), 10);
    const now = new Date();

    await ctx.db.insert("licenses", {
      userId: user._id,
      planType: "trial",
      status: "trial",
      priceUsd: 0,
      startDate: now.toISOString(),
      studiesUsed: 0,
      maxStudies: demoMaxConversions,
    });
  },
});

// Alias legacy para compatibilidad con código existente
export const activateTrial = activateDemo;

// ─── Mutation: Solicitar licencia (Paciente, Pro, Personalizado) ──────────────

export const requestLicense = mutation({
  args: {
    planType: v.union(v.literal("premium"), v.literal("pro"), v.literal("paciente"), v.literal("personalizado")),
    doctorName: v.optional(v.string()),
    doctorSpecialty: v.optional(v.string()),
    doctorEmail: v.optional(v.string()),
    doctorCountry: v.optional(v.string()),
    doctorCity: v.optional(v.string()),
    doctorRegistration: v.optional(v.string()),
    // Personalizado: módulos seleccionados y cotización
    customModules: v.optional(v.string()),
    customMonthlyTotal: v.optional(v.number()),
    customAnnualTotal: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);

    // Verificar si ya tiene solicitud pendiente
    const existing = await ctx.db
      .query("licenseRequests")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    // Si ya tiene licencia activa
    const license = await ctx.db
      .query("licenses")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (license && (license.status === "active")) {
      throw new ConvexError({ message: "Ya tiene una licencia activa.", code: "CONFLICT" });
    }

    const now = new Date().toISOString();

    if (existing) {
      // Actualizar solicitud existente
      await ctx.db.patch(existing._id, {
        planType: args.planType,
        status: "pending",
        requestedAt: now,
        doctorName: args.doctorName,
        doctorSpecialty: args.doctorSpecialty,
        doctorEmail: args.doctorEmail,
        doctorCountry: args.doctorCountry,
        doctorCity: args.doctorCity,
        doctorRegistration: args.doctorRegistration,
        customModules: args.customModules,
        customMonthlyTotal: args.customMonthlyTotal,
        customAnnualTotal: args.customAnnualTotal,
      });
    } else {
      await ctx.db.insert("licenseRequests", {
        userId: user._id,
        planType: args.planType,
        status: "pending",
        requestedAt: now,
        doctorName: args.doctorName,
        doctorSpecialty: args.doctorSpecialty,
        doctorEmail: args.doctorEmail,
        doctorCountry: args.doctorCountry,
        doctorCity: args.doctorCity,
        doctorRegistration: args.doctorRegistration,
        customModules: args.customModules,
        customMonthlyTotal: args.customMonthlyTotal,
        customAnnualTotal: args.customAnnualTotal,
      });
    }
  },
});

// ─── Mutation: Incrementar estudios usados (trial) ────────────────────────────

export const incrementStudiesUsed = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const license = await ctx.db
      .query("licenses")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (!license || license.status !== "trial") return;
    await ctx.db.patch(license._id, { studiesUsed: (license.studiesUsed ?? 0) + 1 });
  },
});

// ─── Helper: generar código de licencia único ─────────────────────────────

function generateLicenseCode(planType: string): string {
  const prefix = planType === "pro" ? "PRO" : planType === "premium" ? "PRM" : planType === "paciente" ? "PAC" : "TRL";
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) code += "-";
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}-${code}`;
}

// ─── Admin: Listar licencias ──────────────────────────────────────────────────

export const adminListLicenses = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<Array<{
    licenseId: Id<"licenses">;
    userId: Id<"users">;
    userName: string;
    userEmail: string;
    planType: string;
    status: string;
    priceUsd: number;
    startDate: string;
    expiryDate?: string;
    activatedAt?: string;
    paymentReference?: string;
    studiesUsed?: number;
    maxStudies?: number;
    doctorName?: string;
    doctorSpecialty?: string;
    doctorCountry?: string;
    licenseCode?: string;
  }>> => {
    // Validate admin token
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!session) throw new ConvexError({ message: "No autorizado", code: "FORBIDDEN" });

    const licenses = await ctx.db.query("licenses").collect();
    return Promise.all(
      licenses.map(async (lic) => {
        const user = await ctx.db.get(lic.userId);
        return {
          licenseId: lic._id,
          userId: lic.userId,
          userName: user ? `${user.name ?? ""} ${user.lastName ?? ""}`.trim() || "Sin nombre" : "—",
          userEmail: user?.email ?? "—",
          planType: lic.planType,
          status: lic.status,
          priceUsd: lic.priceUsd,
          startDate: lic.startDate,
          expiryDate: lic.expiryDate,
          activatedAt: lic.activatedAt,
          paymentReference: lic.paymentReference,
          studiesUsed: lic.studiesUsed,
          maxStudies: lic.maxStudies,
          doctorName: lic.doctorName,
          doctorSpecialty: lic.doctorSpecialty,
          doctorCountry: lic.doctorCountry,
          licenseCode: lic.licenseCode,
        };
      })
    );
  },
});

// ─── Admin: Listar solicitudes de licencia ────────────────────────────────────

export const adminListRequests = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<Array<{
    requestId: Id<"licenseRequests">;
    userId: Id<"users">;
    userName: string;
    userEmail: string;
    planType: string;
    status: string;
    requestedAt: string;
    doctorName?: string;
    doctorSpecialty?: string;
    doctorEmail?: string;
    doctorCountry?: string;
    doctorCity?: string;
    doctorRegistration?: string;
  }>> => {
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!session) throw new ConvexError({ message: "No autorizado", code: "FORBIDDEN" });

    const requests = await ctx.db.query("licenseRequests").collect();
    return Promise.all(
      requests.map(async (req) => {
        const user = await ctx.db.get(req.userId);
        return {
          requestId: req._id,
          userId: req.userId,
          userName: user ? `${user.name ?? ""} ${user.lastName ?? ""}`.trim() || "Sin nombre" : "—",
          userEmail: user?.email ?? "—",
          planType: req.planType,
          status: req.status,
          requestedAt: req.requestedAt,
          doctorName: req.doctorName,
          doctorSpecialty: req.doctorSpecialty,
          doctorEmail: req.doctorEmail,
          doctorCountry: req.doctorCountry,
          doctorCity: req.doctorCity,
          doctorRegistration: req.doctorRegistration,
        };
      })
    );
  },
});

// ─── Admin: Activar licencia ──────────────────────────────────────────────────

export const adminActivateLicense = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    planType: v.union(v.literal("premium"), v.literal("pro"), v.literal("paciente")),
    paymentReference: v.optional(v.string()),
    priceUsd: v.number(),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!session) throw new ConvexError({ message: "No autorizado", code: "FORBIDDEN" });

    const now = new Date();
    const maxDevices = parseInt(
      await getSetting(ctx, `license_${args.planType}_max_devices`, args.planType === "pro" ? "2" : "1"),
      10
    );

    // Obtener datos médicos de la solicitud si existe
    const request = await ctx.db
      .query("licenseRequests")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    // Verificar si ya tiene licencia
    const existing = await ctx.db
      .query("licenses")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    const licenseCode = generateLicenseCode(args.planType);

    const licenseData = {
      userId: args.userId,
      planType: args.planType,
      status: "active" as const,
      priceUsd: args.priceUsd,
      startDate: now.toISOString(),
      maxDevices,
      activatedAt: now.toISOString(),
      paymentReference: args.paymentReference,
      notes: args.notes,
      licenseCode,
      doctorName: request?.doctorName,
      doctorSpecialty: request?.doctorSpecialty,
      doctorEmail: request?.doctorEmail,
      doctorCountry: request?.doctorCountry,
      doctorCity: request?.doctorCity,
      doctorRegistration: request?.doctorRegistration,
    };

    let licenseId: Id<"licenses">;
    if (existing) {
      await ctx.db.patch(existing._id, licenseData);
      licenseId = existing._id;
    } else {
      licenseId = await ctx.db.insert("licenses", licenseData);
    }

    // Registrar en historial de activaciones
    await ctx.db.insert("licenseActivations", {
      licenseId,
      userId: args.userId,
      activatedAt: now.toISOString(),
      activatedBy: "admin",
      planType: args.planType,
      notes: args.notes,
    });

    // Marcar solicitud como aprobada
    if (request) {
      await ctx.db.patch(request._id, { status: "approved" });
    }

    // Incrementar contador de ventas promocionales
    const soldKey = `license_${args.planType}_promo_sold`;
    const soldStr = await getSetting(ctx, soldKey, "0");
    const promoMax = parseInt(await getSetting(ctx, `license_${args.planType}_promo_max`, "10"), 10);
    const sold = parseInt(soldStr, 10);
    if (sold < promoMax) {
      await setSetting(ctx, soldKey, String(sold + 1));
    }
  },
});

// ─── Admin: Suspender / Revocar licencia ──────────────────────────────────────

export const adminRevokeLicense = mutation({
  args: {
    token: v.string(),
    licenseId: v.id("licenses"),
    status: v.union(v.literal("suspended"), v.literal("expired")),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!session) throw new ConvexError({ message: "No autorizado", code: "FORBIDDEN" });
    await ctx.db.patch(args.licenseId, { status: args.status });
  },
});

// ─── Admin: Actualizar plan Y estado de licencia (sistema inteligente) ────────

export const adminUpdateLicense = mutation({
  args: {
    token: v.string(),
    licenseId: v.id("licenses"),
    planType: v.union(
      v.literal("trial"),
      v.literal("personal"),
      v.literal("premium"),
      v.literal("pro"),
      v.literal("paciente"),
      v.literal("empresa")
    ),
    status: v.union(
      v.literal("trial"),
      v.literal("active"),
      v.literal("expired"),
      v.literal("pending"),
      v.literal("suspended"),
      v.literal("pending_payment"),
      v.literal("revoked"),
      v.literal("finished")
    ),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!session) throw new ConvexError({ message: "No autorizado", code: "FORBIDDEN" });

    const license = await ctx.db.get(args.licenseId);
    if (!license) throw new ConvexError({ message: "Licencia no encontrada", code: "NOT_FOUND" });

    const previousPlan = license.planType;
    const previousStatus = license.status;
    const now = new Date().toISOString();

    // Calcular expiryDate para trial
    let expiryDate = license.expiryDate;
    let activatedAt = license.activatedAt;

    if (args.planType === "trial" && args.status === "trial" && !license.expiryDate) {
      const trialDays = parseInt(await getSetting(ctx, "license_trial_days", "3"), 10);
      expiryDate = addDays(new Date(), trialDays);
    }

    if (args.status === "active" && !license.activatedAt) {
      activatedAt = now;
    }

    // Si plan cambia de trial a otro, limpiar expiryDate
    if (previousPlan === "trial" && args.planType !== "trial") {
      expiryDate = undefined;
    }

    // Generar código de licencia si no tiene y se activa
    let licenseCode = license.licenseCode;
    if (!licenseCode && args.status === "active") {
      licenseCode = generateLicenseCode(args.planType);
    }

    await ctx.db.patch(args.licenseId, {
      planType: args.planType,
      status: args.status,
      expiryDate,
      activatedAt,
      licenseCode,
    });

    // Registrar en auditoría solo si hubo cambio
    if (previousPlan !== args.planType || previousStatus !== args.status) {
      await ctx.db.insert("licenseAudit", {
        licenseId: args.licenseId,
        userId: license.userId,
        changedAt: now,
        changedBy: "admin",
        previousPlan,
        newPlan: args.planType,
        previousStatus,
        newStatus: args.status,
        notes: args.notes,
      });

      // Registrar también en licenseActivations cuando se activa
      if (args.status === "active") {
        await ctx.db.insert("licenseActivations", {
          licenseId: args.licenseId,
          userId: license.userId,
          activatedAt: now,
          activatedBy: "admin",
          planType: args.planType,
          notes: args.notes,
        });
      }
    }
  },
});

// ─── Admin: Crear licencia para un usuario (sin solicitud previa) ──────────────

export const adminCreateLicense = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    planType: v.union(
      v.literal("trial"),
      v.literal("personal"),
      v.literal("premium"),
      v.literal("pro"),
      v.literal("paciente"),
      v.literal("empresa")
    ),
    status: v.union(
      v.literal("trial"),
      v.literal("active"),
      v.literal("expired"),
      v.literal("pending"),
      v.literal("suspended"),
      v.literal("pending_payment"),
      v.literal("revoked"),
      v.literal("finished")
    ),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"licenses">> => {
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!session) throw new ConvexError({ message: "No autorizado", code: "FORBIDDEN" });

    const now = new Date();

    // Si ya existe, actualizar
    const existing = await ctx.db
      .query("licenses")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();

    if (existing) {
      throw new ConvexError({ message: "El usuario ya tiene una licencia. Use adminUpdateLicense.", code: "CONFLICT" });
    }

    let expiryDate: string | undefined;
    if (args.planType === "trial") {
      const trialDays = parseInt(await getSetting(ctx, "license_trial_days", "3"), 10);
      expiryDate = addDays(now, trialDays);
    }

    const licenseCode = args.status === "active" ? generateLicenseCode(args.planType) : undefined;
    const activatedAt = args.status === "active" ? now.toISOString() : undefined;

    const licenseId = await ctx.db.insert("licenses", {
      userId: args.userId,
      planType: args.planType,
      status: args.status,
      priceUsd: 0,
      startDate: now.toISOString(),
      expiryDate,
      studiesUsed: args.planType === "trial" ? 0 : undefined,
      maxStudies: args.planType === "trial" ? 10 : undefined,
      activatedAt,
      licenseCode,
      notes: args.notes,
    });

    // Auditoría
    await ctx.db.insert("licenseAudit", {
      licenseId,
      userId: args.userId,
      changedAt: now.toISOString(),
      changedBy: "admin",
      previousPlan: "—",
      newPlan: args.planType,
      previousStatus: "—",
      newStatus: args.status,
      notes: args.notes ?? "Licencia creada por administrador",
    });

    if (args.status === "active") {
      await ctx.db.insert("licenseActivations", {
        licenseId,
        userId: args.userId,
        activatedAt: now.toISOString(),
        activatedBy: "admin",
        planType: args.planType,
        notes: args.notes,
      });
    }

    return licenseId;
  },
});

// ─── Admin: Listar auditoría de cambios de licencia ───────────────────────────

export const adminListLicenseAudit = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<Array<{
    auditId: Id<"licenseAudit">;
    licenseId: Id<"licenses">;
    userId: Id<"users">;
    userName: string;
    userEmail: string;
    changedAt: string;
    changedBy: string;
    previousPlan: string;
    newPlan: string;
    previousStatus: string;
    newStatus: string;
    notes?: string;
  }>> => {
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!session) throw new ConvexError({ message: "No autorizado", code: "FORBIDDEN" });

    const audits = await ctx.db.query("licenseAudit").order("desc").take(300);
    return Promise.all(
      audits.map(async (a) => {
        const user = await ctx.db.get(a.userId);
        return {
          auditId: a._id,
          licenseId: a.licenseId,
          userId: a.userId,
          userName: user ? `${user.name ?? ""} ${user.lastName ?? ""}`.trim() || "Sin nombre" : "—",
          userEmail: user?.email ?? "—",
          changedAt: a.changedAt,
          changedBy: a.changedBy,
          previousPlan: a.previousPlan,
          newPlan: a.newPlan,
          previousStatus: a.previousStatus,
          newStatus: a.newStatus,
          notes: a.notes,
        };
      })
    );
  },
});



// ─── Admin: Estadísticas comerciales ─────────────────────────────────────────

export const adminGetLicenseStats = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{
    totalLicenses: number;
    activeLicenses: number;
    trialLicenses: number;
    pendingLicenses: number;
    expiredLicenses: number;
    pacienteCount: number;
    premiumCount: number;
    proCount: number;
    totalRevenue: number;
    pendingRequests: number;
    monthlyRevenue: Array<{ month: string; revenue: number; count: number }>;
    byCountry: Array<{ country: string; count: number }>;
  }> => {
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!session) throw new ConvexError({ message: "No autorizado", code: "FORBIDDEN" });

    const licenses = await ctx.db.query("licenses").collect();
    const requests = await ctx.db.query("licenseRequests").collect();

    const active = licenses.filter((l) => l.status === "active");
    const trial = licenses.filter((l) => l.status === "trial");
    const pending = licenses.filter((l) => l.status === "pending");
    const expired = licenses.filter((l) => l.status === "expired" || l.status === "suspended");

    // ── Ingresos mensuales (últimos 6 meses) ──────────────────────────────
    const now = new Date();
    const monthlyMap = new Map<string, { revenue: number; count: number }>();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      monthlyMap.set(key, { revenue: 0, count: 0 });
    }
    for (const lic of active) {
      if (!lic.activatedAt) continue;
      const d = new Date(lic.activatedAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const entry = monthlyMap.get(key);
      if (entry) {
        entry.revenue += lic.priceUsd;
        entry.count += 1;
      }
    }
    const monthlyRevenue = Array.from(monthlyMap.entries()).map(([month, v]) => ({ month, ...v }));

    // ── Ventas por país ───────────────────────────────────────────────────
    const countryMap = new Map<string, number>();
    for (const lic of active) {
      const country = lic.doctorCountry ?? "No especificado";
      countryMap.set(country, (countryMap.get(country) ?? 0) + 1);
    }
    const byCountry = Array.from(countryMap.entries())
      .map(([country, count]) => ({ country, count }))
      .sort((a, b) => b.count - a.count);

    return {
      totalLicenses: licenses.length,
      activeLicenses: active.length,
      trialLicenses: trial.length,
      pendingLicenses: pending.length,
      expiredLicenses: expired.length,
      pacienteCount: active.filter((l) => l.planType === "paciente").length,
      premiumCount: active.filter((l) => l.planType === "premium").length,
      proCount: active.filter((l) => l.planType === "pro").length,
      totalRevenue: active.reduce((s, l) => s + l.priceUsd, 0),
      pendingRequests: requests.filter((r) => r.status === "pending").length,
      monthlyRevenue,
      byCountry,
    };
  },
});

// ─── Admin: Listar historial de activaciones ──────────────────────────────────

export const adminListActivations = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<Array<{
    activationId: Id<"licenseActivations">;
    licenseId: Id<"licenses">;
    userId: Id<"users">;
    userName: string;
    userEmail: string;
    planType: string;
    activatedAt: string;
    activatedBy: string;
    licenseCode?: string;
    notes?: string;
  }>> => {
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!session) throw new ConvexError({ message: "No autorizado", code: "FORBIDDEN" });

    const activations = await ctx.db.query("licenseActivations").order("desc").take(200);
    return Promise.all(
      activations.map(async (act) => {
        const user = await ctx.db.get(act.userId);
        const license = await ctx.db.get(act.licenseId);
        return {
          activationId: act._id,
          licenseId: act.licenseId,
          userId: act.userId,
          userName: user ? `${user.name ?? ""} ${user.lastName ?? ""}`.trim() || "Sin nombre" : "—",
          userEmail: user?.email ?? "—",
          planType: act.planType,
          activatedAt: act.activatedAt,
          activatedBy: act.activatedBy,
          licenseCode: license?.licenseCode,
          notes: act.notes,
        };
      })
    );
  },
});

// ─── Admin: Obtener historial de auditoría para un usuario específico ─────────

export const adminGetUserLicenseAudit = query({
  args: { token: v.string(), userId: v.id("users") },
  handler: async (ctx, args): Promise<Array<{
    changedAt: string;
    changedBy: string;
    previousPlan: string;
    newPlan: string;
    previousStatus: string;
    newStatus: string;
    notes?: string;
  }>> => {
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!session) throw new ConvexError({ message: "No autorizado", code: "FORBIDDEN" });

    const audits = await ctx.db
      .query("licenseAudit")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(50);

    return audits.map((a) => ({
      changedAt: a.changedAt,
      changedBy: a.changedBy,
      previousPlan: a.previousPlan,
      newPlan: a.newPlan,
      previousStatus: a.previousStatus,
      newStatus: a.newStatus,
      notes: a.notes,
    }));
  },
});
