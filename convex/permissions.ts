/**
 * Sistema de Permisos Centralizado — AFGMedView v3
 *
 * Arquitectura: PLAN ≠ PERMISO
 * Los permisos efectivos de un usuario se calculan como:
 *   base(plan) + addOns(usuario) + overrides(usuario)
 *
 * Principio:
 *  1. Se consulta la tabla `planPermissions` para obtener las claves base del plan.
 *  2. Si no existe registro para el plan (primera vez), se usan los defaults hardcoded.
 *  3. Los add-ons activos del usuario agregan claves adicionales.
 *  4. Los overrides del admin pueden conceder (true) o denegar (false) claves específicas.
 *  5. Los overrides tienen prioridad sobre todo lo demás.
 *
 * Formato de claves: "<módulo>.<acción>" — ej. "viewer.measure", "pacs.connect"
 *
 * Planes soportados:
 *  trial       → DEMO: acceso completo a herramientas, limite conversiones, sin PACS
 *  life        → Plan básico (=paciente/personal legacy)
 *  medico      → Plan profesional (=pro/premium legacy)
 *  empresa     → Plan corporativo, incluye admin.company y pacs.connect
 *  paciente    → alias de life (legacy)
 *  personal    → alias de life (legacy)
 *  premium     → alias de medico (legacy)
 *  pro         → alias de medico (legacy)
 */

import { query, mutation, internalMutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel.d.ts";

// ─── Constantes de claves de permisos ─────────────────────────────────────────

/** Todas las claves de permisos reconocidas por el sistema. */
export const PERMISSION_KEYS = [
  // ── Visor básico ──────────────────────────────────────────────────────────
  "viewer.view",           // Visualizar archivos DICOM
  "viewer.zoom",           // Zoom manual
  "viewer.pan",            // Desplazamiento manual
  "viewer.fullscreen",     // Pantalla completa
  "viewer.thumbnails",     // Miniaturas de series
  "viewer.multiple_series",// Múltiples series en un estudio
  // ── Visor avanzado ─────────────────────────────────────────────────────
  "viewer.window_level",   // Ajuste Window/Level
  "viewer.clinical_presets",// Presets clínicos (pulmón, hueso, etc.)
  "viewer.rotate",         // Rotar imagen
  "viewer.flip",           // Voltear imagen
  "viewer.cine",           // Modo cine (reproducción de secuencias)
  // ── Herramientas PRO ────────────────────────────────────────────────────
  "viewer.measure",        // Mediciones (distancia, ángulo, etc.)
  "viewer.roi",            // Regiones de interés (ROI)
  "viewer.annotate",       // Anotaciones de texto/flecha
  "viewer.sync_series",    // Sincronizar scroll entre series
  "viewer.compare",        // Comparar estudios lado a lado
  "viewer.mpr",            // Reconstrucción Multiplanar
  "viewer.dual_mode",      // Modo diagnóstico dual (dos ventanas)
  "viewer.edit_dicom",     // Editar metadatos DICOM
  // ── Exportación ─────────────────────────────────────────────────────────
  "export.jpg",            // Exportar como JPEG/PNG
  "export.mp4",            // Exportar como MP4 (video cine)
  "export.dicom",          // Guardar/exportar DICOM
  "export.with_overlays",  // Exportar con mediciones/anotaciones superpuestas
  // ── Informes ────────────────────────────────────────────────────────────
  "reports.create",        // Crear informes radiológicos (IA o manual)
  "reports.export",        // Exportar informe a PDF
  // ── PACS / Orthanc ──────────────────────────────────────────────────────
  "pacs.connect",          // Conectar y consultar un servidor PACS/Orthanc
  "pacs.worklist",         // Bandeja de trabajo DICOM (worklist)
  // ── Administración ──────────────────────────────────────────────────────
  "admin.company",         // Administrar empresa (usuarios, equipos, etc.)
  // ── Apariencia ──────────────────────────────────────────────────────────
  "ui.hide_watermark",     // Ocultar marca de agua de versión demo
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

// ─── Defaults por plan ────────────────────────────────────────────────────────

/** Devuelve el conjunto de claves de permisos para un plan dado (fallback hardcoded). */
function defaultPermissionsForPlan(planId: string): Set<string> {
  const keys = new Set<string>();

  // Helper para agregar múltiples claves
  const add = (...ks: string[]) => ks.forEach((k) => keys.add(k));

  // Normalizar aliases legacy al plan canónico
  const canonical = normalizeAlias(planId);

  if (canonical === "trial") {
    // DEMO: acceso completo para demostrar el potencial, sin ocultar watermark ni PACS
    add(
      "viewer.view", "viewer.zoom", "viewer.pan", "viewer.fullscreen",
      "viewer.thumbnails", "viewer.multiple_series",
      "viewer.window_level", "viewer.clinical_presets", "viewer.rotate", "viewer.flip", "viewer.cine",
      "viewer.measure", "viewer.roi", "viewer.annotate", "viewer.sync_series", "viewer.compare",
      "viewer.dual_mode", "viewer.edit_dicom",
      "export.jpg", "export.mp4", "export.dicom", "export.with_overlays",
      "reports.create", "reports.export",
    );
    // trial NO incluye: pacs.connect, pacs.worklist, admin.company, ui.hide_watermark
    return keys;
  }

  if (canonical === "life") {
    // Plan básico: visualización y exportación simple
    add(
      "viewer.view", "viewer.zoom", "viewer.pan", "viewer.fullscreen",
      "viewer.thumbnails", "viewer.multiple_series",
      "viewer.window_level", "viewer.clinical_presets", "viewer.rotate", "viewer.flip", "viewer.cine",
      "export.jpg", "export.mp4",
      "ui.hide_watermark",
    );
    // life NO incluye: measure, roi, annotate, sync_series, compare, mpr, dual_mode
    // NO: reports.create, reports.export, pacs.connect, admin.company
    return keys;
  }

  if (canonical === "medico") {
    // Plan profesional: todo el visor + informes + exportación completa
    add(
      "viewer.view", "viewer.zoom", "viewer.pan", "viewer.fullscreen",
      "viewer.thumbnails", "viewer.multiple_series",
      "viewer.window_level", "viewer.clinical_presets", "viewer.rotate", "viewer.flip", "viewer.cine",
      "viewer.measure", "viewer.roi", "viewer.annotate", "viewer.sync_series", "viewer.compare",
      "viewer.mpr", "viewer.dual_mode", "viewer.edit_dicom",
      "export.jpg", "export.mp4", "export.dicom", "export.with_overlays",
      "reports.create", "reports.export",
      "ui.hide_watermark",
    );
    // medico NO incluye por defecto: pacs.connect, pacs.worklist, admin.company
    // (son add-ons disponibles para comprar)
    return keys;
  }

  if (canonical === "empresa") {
    // Plan corporativo: todo, más admin y PACS
    add(
      "viewer.view", "viewer.zoom", "viewer.pan", "viewer.fullscreen",
      "viewer.thumbnails", "viewer.multiple_series",
      "viewer.window_level", "viewer.clinical_presets", "viewer.rotate", "viewer.flip", "viewer.cine",
      "viewer.measure", "viewer.roi", "viewer.annotate", "viewer.sync_series", "viewer.compare",
      "viewer.mpr", "viewer.dual_mode", "viewer.edit_dicom",
      "export.jpg", "export.mp4", "export.dicom", "export.with_overlays",
      "reports.create", "reports.export",
      "pacs.connect", "pacs.worklist",
      "admin.company",
      "ui.hide_watermark",
    );
    return keys;
  }

  // Desconocido / personalizado → vacío (sin acceso)
  return keys;
}

/**
 * Normaliza aliases de planes legacy al plan canónico moderno.
 * paciente / personal → life
 * pro / premium / personalizado → medico
 */
function normalizeAlias(planId: string): string {
  switch (planId) {
    case "paciente":
    case "personal":
      return "life";
    case "pro":
    case "premium":
    case "personalizado":
      return "medico";
    default:
      return planId; // trial, life, medico, empresa — sin cambio
  }
}

// ─── Helper: obtener usuario autenticado ──────────────────────────────────────

async function getAuthenticatedUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

// ─── Query: Permisos efectivos del usuario actual ─────────────────────────────

export const getMyEffectivePermissions = query({
  args: {},
  handler: async (ctx): Promise<{
    permissions: Record<string, boolean>;
    planId: string | null;
    isLoading: false;
  }> => {
    const user = await getAuthenticatedUser(ctx);
    if (!user) {
      return { permissions: {}, planId: null, isLoading: false };
    }

    // 1. Obtener licencia activa del usuario
    const license = await ctx.db
      .query("licenses")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    const planId = license?.planType ?? null;

    // 2. Verificar que la licencia esté activa (solo conceder permisos si canAccess)
    const isActive = license !== null && (license.status === "active" || license.status === "trial");
    if (!isActive) {
      return { permissions: {}, planId, isLoading: false };
    }

    // 3. Obtener permisos base del plan desde la BD (o usar defaults hardcoded)
    let baseKeys: Set<string>;
    if (planId) {
      const planPerms = await ctx.db
        .query("planPermissions")
        .withIndex("by_planId", (q) => q.eq("planId", planId))
        .first();

      if (planPerms) {
        baseKeys = new Set(planPerms.permissionKeys);
      } else {
        // Fallback: defaults hardcoded hasta que el admin configure la tabla
        baseKeys = defaultPermissionsForPlan(planId);
      }
    } else {
      baseKeys = new Set<string>();
    }

    // 4. Agregar claves de add-ons activos
    const now = new Date().toISOString();
    const addOns = await ctx.db
      .query("userAddOns")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    for (const addOn of addOns) {
      if (!addOn.active) continue;
      if (addOn.expiresAt && addOn.expiresAt < now) continue;
      for (const key of addOn.permissionKeys) {
        baseKeys.add(key);
      }
    }

    // 5. Construir mapa de permisos base (todo lo que tenemos hasta aquí = true)
    const permissions: Record<string, boolean> = {};
    for (const key of PERMISSION_KEYS) {
      permissions[key] = baseKeys.has(key);
    }

    // 6. Aplicar overrides del admin (tienen prioridad máxima)
    const overrides = await ctx.db
      .query("userPermissionOverrides")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();

    for (const override of overrides) {
      permissions[override.permissionKey] = override.granted;
    }

    return { permissions, planId, isLoading: false };
  },
});

// ─── Query: Permisos base de un plan (para back office) ───────────────────────

export const getPlanPermissions = query({
  args: { planId: v.string(), token: v.string() },
  handler: async (ctx, args): Promise<{
    planId: string;
    permissionKeys: string[];
    isFromDefaults: boolean;
  }> => {
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!session) throw new ConvexError({ message: "No autorizado", code: "FORBIDDEN" });

    const row = await ctx.db
      .query("planPermissions")
      .withIndex("by_planId", (q) => q.eq("planId", args.planId))
      .first();

    if (row) {
      return { planId: args.planId, permissionKeys: row.permissionKeys, isFromDefaults: false };
    }

    // Devolver defaults hardcoded
    const defaults = defaultPermissionsForPlan(args.planId);
    return { planId: args.planId, permissionKeys: Array.from(defaults), isFromDefaults: true };
  },
});

// ─── Mutation: Actualizar permisos de un plan (back office) ───────────────────

export const setPlanPermissions = mutation({
  args: {
    token: v.string(),
    planId: v.string(),
    permissionKeys: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!session) throw new ConvexError({ message: "No autorizado", code: "FORBIDDEN" });

    const now = new Date().toISOString();
    const existing = await ctx.db
      .query("planPermissions")
      .withIndex("by_planId", (q) => q.eq("planId", args.planId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { permissionKeys: args.permissionKeys, updatedAt: now });
    } else {
      await ctx.db.insert("planPermissions", {
        planId: args.planId,
        permissionKeys: args.permissionKeys,
        updatedAt: now,
      });
    }
  },
});

// ─── Mutation: Establecer override de permiso para un usuario ─────────────────

export const setUserPermissionOverride = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    permissionKey: v.string(),
    granted: v.boolean(),
  },
  handler: async (ctx, args): Promise<void> => {
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!session) throw new ConvexError({ message: "No autorizado", code: "FORBIDDEN" });

    const now = new Date().toISOString();
    const existing = await ctx.db
      .query("userPermissionOverrides")
      .withIndex("by_user_and_key", (q) =>
        q.eq("userId", args.userId).eq("permissionKey", args.permissionKey)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { granted: args.granted, updatedAt: now });
    } else {
      await ctx.db.insert("userPermissionOverrides", {
        userId: args.userId,
        permissionKey: args.permissionKey,
        granted: args.granted,
        setBy: "admin",
        updatedAt: now,
      });
    }
  },
});

// ─── Mutation: Eliminar override de permiso ───────────────────────────────────

export const removeUserPermissionOverride = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    permissionKey: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!session) throw new ConvexError({ message: "No autorizado", code: "FORBIDDEN" });

    const existing = await ctx.db
      .query("userPermissionOverrides")
      .withIndex("by_user_and_key", (q) =>
        q.eq("userId", args.userId).eq("permissionKey", args.permissionKey)
      )
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

// ─── Mutation: Activar/desactivar add-on para un usuario ──────────────────────

export const setUserAddOn = mutation({
  args: {
    token: v.string(),
    userId: v.id("users"),
    addOnId: v.string(),
    permissionKeys: v.array(v.string()),
    active: v.boolean(),
    expiresAt: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!session) throw new ConvexError({ message: "No autorizado", code: "FORBIDDEN" });

    const now = new Date().toISOString();
    const existing = await ctx.db
      .query("userAddOns")
      .withIndex("by_user_and_addon", (q) =>
        q.eq("userId", args.userId).eq("addOnId", args.addOnId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        permissionKeys: args.permissionKeys,
        active: args.active,
        expiresAt: args.expiresAt,
      });
    } else {
      await ctx.db.insert("userAddOns", {
        userId: args.userId,
        addOnId: args.addOnId,
        permissionKeys: args.permissionKeys,
        activatedAt: now,
        active: args.active,
        expiresAt: args.expiresAt,
      });
    }
  },
});

// ─── Query: Add-ons de un usuario (back office) ───────────────────────────────

export const getUserAddOns = query({
  args: { token: v.string(), userId: v.id("users") },
  handler: async (ctx, args): Promise<Array<{
    addOnId: Id<"userAddOns">;
    slug: string;
    permissionKeys: string[];
    active: boolean;
    activatedAt: string;
    expiresAt?: string;
  }>> => {
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!session) throw new ConvexError({ message: "No autorizado", code: "FORBIDDEN" });

    const addOns = await ctx.db
      .query("userAddOns")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    return addOns.map((a) => ({
      addOnId: a._id,
      slug: a.addOnId,
      permissionKeys: a.permissionKeys,
      active: a.active,
      activatedAt: a.activatedAt,
      expiresAt: a.expiresAt,
    }));
  },
});

// ─── Query: Overrides de permiso de un usuario (back office) ─────────────────

export const getUserPermissionOverrides = query({
  args: { token: v.string(), userId: v.id("users") },
  handler: async (ctx, args): Promise<Array<{
    overrideId: Id<"userPermissionOverrides">;
    permissionKey: string;
    granted: boolean;
    setBy: string;
    updatedAt: string;
  }>> => {
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!session) throw new ConvexError({ message: "No autorizado", code: "FORBIDDEN" });

    const overrides = await ctx.db
      .query("userPermissionOverrides")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    return overrides.map((o) => ({
      overrideId: o._id,
      permissionKey: o.permissionKey,
      granted: o.granted,
      setBy: o.setBy,
      updatedAt: o.updatedAt,
    }));
  },
});

// ─── Internal: Inicializar planPermissions desde defaults ─────────────────────
// Llamar una vez después de desplegar para poblar la tabla con valores iniciales.

export const initPlanPermissionsFromDefaults = internalMutation({
  args: {},
  handler: async (ctx): Promise<void> => {
    const plans = ["trial", "life", "medico", "empresa", "paciente", "personal", "pro", "premium", "personalizado"];
    const now = new Date().toISOString();

    for (const planId of plans) {
      const existing = await ctx.db
        .query("planPermissions")
        .withIndex("by_planId", (q) => q.eq("planId", planId))
        .first();

      if (!existing) {
        const defaults = defaultPermissionsForPlan(planId);
        await ctx.db.insert("planPermissions", {
          planId,
          permissionKeys: Array.from(defaults),
          updatedAt: now,
        });
      }
    }
  },
});
