/**
 * Plans module — source of truth for AFG MedView pricing plans.
 * Provides queries for the landing page and mutations for Back Office admin.
 * On first call to `ensureSeed`, the default plans are seeded automatically.
 */
import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";

// ─── Default plan data ─────────────────────────────────────────────────────────

const DEFAULT_PLANS = [
  {
    planId: "demo",
    name: "DEMO",
    badge: "GRATIS",
    badgeStyle: "bg-slate-700 text-slate-100 ring-1 ring-slate-500",
    price: "USD 0",
    priceDetail: "",
    paymentMethod: "Sin pago",
    description: "Pruebe AFGMEDVIEW antes de adquirir una licencia.",
    features: [
      "Hasta 3 conversiones DICOM",
      "Visualización DICOM",
      "Conversión DICOM a JPG",
      "Conversión DICOM a MP4",
      "Acceso de demostración",
      "Una sola activación por usuario",
    ],
    footnote:
      "Al agotar las 3 conversiones, el acceso se bloquea automáticamente y se solicita activar licencia.",
    ctaLanding: "PROBAR GRATIS",
    ctaPlanes: "PROBAR GRATIS",
    ctaPago: "Seleccionar Plan",
    darkCardStyle:
      "bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700 hover:border-slate-500",
    darkHeaderStyle: "text-slate-100",
    darkBtnStyle: "bg-slate-600 hover:bg-slate-500 text-white",
    isActive: true,
    sortOrder: 0,
    paymentMode: "free",
    planType: "individual",
    maxUsers: 1,
    maxStudies: 3,
    storageGb: 0,
  },
  {
    planId: "paciente",
    name: "PACIENTE",
    badge: "PARA PACIENTES",
    badgeStyle: "bg-teal-600 text-teal-50 ring-1 ring-teal-400",
    price: "USD 5.99",
    priceDetail: "/ mes",
    paymentMethod: "Mensual",
    description: "Ideal para pacientes y usuarios particulares.",
    features: [
      "Conversión DICOM a JPG",
      "Conversión DICOM a MP4",
      "Visualización básica",
      "Organización de estudios",
      "Hasta 10 estudios convertidos por mes",
    ],
    notIncluded: ["Herramientas profesionales de medición"],
    ctaLanding: "CONTRATAR PLAN",
    ctaPlanes: "CONTRATAR PLAN",
    ctaPago: "Seleccionar Plan",
    darkCardStyle:
      "bg-gradient-to-br from-teal-950 to-slate-900 border-teal-800 hover:border-teal-500",
    darkHeaderStyle: "text-teal-100",
    darkBtnStyle: "bg-teal-600 hover:bg-teal-500 text-white",
    isActive: true,
    sortOrder: 1,
    paymentMode: "monthly",
    planType: "individual",
    maxUsers: 1,
    maxStudies: 10,
    storageGb: 5,
  },
  {
    planId: "pro",
    name: "MEDVIEW PRO",
    badge: "MÁS ELEGIDO POR MÉDICOS",
    badgeStyle: "bg-blue-600 text-blue-50 ring-1 ring-blue-400",
    price: "USD 149.99",
    priceDetail: "/ mes",
    paymentMethod: "Mensual",
    description: "Licencia profesional completa para médicos.",
    features: [
      "Visor DICOM profesional",
      "Herramientas completas de medición",
      "Distancia, Ángulo, Área, ROI y Volumen",
      "Histograma",
      "Zoom profesional y Pan",
      "Window Width / Window Level",
      "Comparación de estudios",
      "Edición de metadatos DICOM",
      "Conversión y estudios ilimitados",
      "Preparado para IA",
      "Preparado para Segunda Opinión",
    ],
    ctaLanding: "ACTIVAR PRO",
    ctaPlanes: "ACTIVAR PRO",
    ctaPago: "Seleccionar Plan",
    darkCardStyle:
      "bg-gradient-to-br from-blue-950 to-indigo-950 border-blue-700 hover:border-blue-400 ring-2 ring-blue-600/40",
    darkHeaderStyle: "text-blue-100",
    darkBtnStyle:
      "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-700/30",
    isActive: true,
    sortOrder: 2,
    paymentMode: "monthly",
    planType: "individual",
    maxUsers: 1,
    maxStudies: 0,
    storageGb: 0,
  },
  {
    planId: "lifetime",
    name: "MEDVIEW PRO LIFETIME",
    badge: "OFERTA ESPECIAL",
    badgeStyle:
      "bg-gradient-to-r from-amber-500 to-yellow-400 text-amber-950 font-extrabold ring-1 ring-amber-300",
    price: "USD 1,500",
    priceDetail: "pago único",
    paymentMethod: "Pago único",
    description: "Licencia permanente — acceso de por vida.",
    features: [
      "Todas las funciones PRO incluidas",
      "Licencia permanente",
      "Actualizaciones gratuitas durante el primer año",
      "Soporte prioritario durante el primer año",
      "Acceso preferencial a módulos futuros",
    ],
    distinctive: "Mejor inversión para profesionales",
    footnote:
      "Después del primer año, las actualizaciones mayores podrán contratarse mediante un plan de mantenimiento opcional.",
    ctaLanding: "OBTENER LICENCIA VITALICIA",
    ctaPlanes: "OBTENER LICENCIA VITALICIA",
    ctaPago: "Seleccionar Plan",
    darkCardStyle:
      "bg-gradient-to-br from-amber-950 to-yellow-950 border-amber-700 hover:border-amber-400 ring-2 ring-amber-500/40",
    darkHeaderStyle: "text-amber-100",
    darkBtnStyle:
      "bg-gradient-to-r from-amber-500 to-yellow-400 hover:from-amber-400 hover:to-yellow-300 text-amber-950 font-bold shadow-lg shadow-amber-700/30",
    isActive: true,
    sortOrder: 3,
    paymentMode: "once",
    planType: "individual",
    maxUsers: 1,
    maxStudies: 0,
    storageGb: 0,
  },
  {
    planId: "empresa",
    name: "MEDVIEW EMPRESA",
    badge: "SOLUCIÓN EMPRESARIAL",
    badgeStyle:
      "bg-gradient-to-r from-[#1F4E7B] to-[#16C6C9] text-white font-bold ring-1 ring-[#16C6C9]",
    price: "USD 7,500",
    priceDetail: "implementación inicial",
    implementationPrice: "USD 7,500",
    monthlyPrice: "USD 150",
    paymentMethod: "Implementación + Mensual",
    description:
      "Solución empresarial para centros de diagnóstico, clínicas y hospitales que requieren múltiples usuarios, gestión centralizada de estudios e infraestructura PACS.",
    features: [
      "Implementación empresarial",
      "Configuración inicial del sistema",
      "Administración de empresa",
      "Creación y eliminación de usuarios",
      "Usuarios médicos/informadores",
      "Gestión de roles",
      "Panel administrativo empresarial",
      "Visor DICOM profesional",
      "PACS / Integración con Orthanc",
      "DICOMweb",
      "Gestión de estudios",
      "Informes médicos",
      "Informe IA (cuando esté habilitado)",
      "MPR",
      "Comparación de estudios",
      "Herramientas de medición completas",
      "WC/WW",
      "Gestión centralizada de usuarios",
      "Soporte empresarial",
      "Configuración inicial personalizada",
    ],
    ctaLanding: "SOLICITAR IMPLEMENTACIÓN",
    ctaPlanes: "SOLICITAR IMPLEMENTACIÓN",
    ctaPago: "Solicitar",
    darkCardStyle:
      "bg-gradient-to-br from-[#0d2744] to-[#0d3347] border-[#16C6C9] hover:border-[#16C6C9] ring-2 ring-[#16C6C9]/40",
    darkHeaderStyle: "text-[#16C6C9]",
    darkBtnStyle:
      "bg-gradient-to-r from-[#1F4E7B] to-[#16C6C9] hover:from-[#16447a] hover:to-[#12a8aa] text-white font-bold shadow-lg",
    isActive: true,
    sortOrder: 4,
    paymentMode: "enterprise",
    planType: "enterprise",
    maxUsers: 0,
    maxStudies: 0,
    storageGb: 0,
  },
];

// ─── Seed helper ───────────────────────────────────────────────────────────────

async function seedIfEmpty(ctx: MutationCtx): Promise<void> {
  const existing = await ctx.db.query("plans").take(1);
  if (existing.length > 0) return;
  for (const plan of DEFAULT_PLANS) {
    await ctx.db.insert("plans", plan);
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function ensureSeeded(_ctx: QueryCtx): Promise<void> {
  // Queries are read-only; seeding happens lazily via mutations only
}

// ─── Internal seed mutation ────────────────────────────────────────────────────

export const seed = internalMutation({
  args: {},
  handler: async (ctx) => {
    await seedIfEmpty(ctx);
  },
});

// ─── Public queries ────────────────────────────────────────────────────────────

/** All plans sorted by sortOrder — for the Back Office editor */
export const list = query({
  args: {},
  handler: async (ctx): Promise<Doc<"plans">[]> => {
    void ensureSeeded(ctx);
    return ctx.db.query("plans").withIndex("by_sortOrder").collect();
  },
});

/** Only active plans — for the landing page */
export const listActive = query({
  args: {},
  handler: async (ctx): Promise<Doc<"plans">[]> => {
    return ctx.db
      .query("plans")
      .withIndex("by_sortOrder")
      .filter((q) => q.eq(q.field("isActive"), true))
      .collect();
  },
});

// ─── Public mutations ──────────────────────────────────────────────────────────

/** Upsert a plan from the Back Office editor */
export const upsert = mutation({
  args: {
    planId: v.string(),
    name: v.string(),
    badge: v.string(),
    badgeStyle: v.string(),
    price: v.string(),
    priceDetail: v.string(),
    promoPrice: v.optional(v.string()),
    paymentMethod: v.string(),
    description: v.string(),
    features: v.array(v.string()),
    notIncluded: v.optional(v.array(v.string())),
    footnote: v.optional(v.string()),
    distinctive: v.optional(v.string()),
    ctaLanding: v.string(),
    ctaPlanes: v.string(),
    ctaPago: v.string(),
    darkCardStyle: v.string(),
    darkHeaderStyle: v.string(),
    darkBtnStyle: v.string(),
    isActive: v.boolean(),
    sortOrder: v.number(),
    // Nuevos campos
    implementationPrice: v.optional(v.string()),
    monthlyPrice: v.optional(v.string()),
    maxUsers: v.optional(v.number()),
    maxStudies: v.optional(v.number()),
    storageGb: v.optional(v.number()),
    paymentMode: v.optional(v.string()),
    planType: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    await seedIfEmpty(ctx);
    const existing = await ctx.db
      .query("plans")
      .withIndex("by_planId", (q) => q.eq("planId", args.planId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("plans", args);
    }
  },
});

/** Seed plans if empty — called once from the Back Office on first load */
export const ensureSeed = mutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    await seedIfEmpty(ctx);
  },
});

/** Force re-seed: update existing plans and insert missing ones */
export const reseed = mutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    for (const plan of DEFAULT_PLANS) {
      const existing = await ctx.db
        .query("plans")
        .withIndex("by_planId", (q) => q.eq("planId", plan.planId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, plan);
      } else {
        await ctx.db.insert("plans", plan);
      }
    }
  },
});

/** Toggle a plan's active state */
export const toggleActive = mutation({
  args: { planId: v.string(), isActive: v.boolean() },
  handler: async (ctx, args): Promise<void> => {
    const plan = await ctx.db
      .query("plans")
      .withIndex("by_planId", (q) => q.eq("planId", args.planId))
      .unique();
    if (plan) {
      await ctx.db.patch(plan._id, { isActive: args.isActive });
    }
  },
});

/** Reorder plans */
export const reorder = mutation({
  args: { planId: v.string(), sortOrder: v.number() },
  handler: async (ctx, args): Promise<void> => {
    const plan = await ctx.db
      .query("plans")
      .withIndex("by_planId", (q) => q.eq("planId", args.planId))
      .unique();
    if (plan) {
      await ctx.db.patch(plan._id, { sortOrder: args.sortOrder });
    }
  },
});
