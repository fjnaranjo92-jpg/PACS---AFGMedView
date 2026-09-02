/**
 * Error logging — registra errores del frontend y permite consultarlos desde el Back Office.
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Detecta el nombre del navegador a partir del userAgent string */
function parseBrowser(ua: string): string {
  if (ua.includes("Edg/")) return "Edge";
  if (ua.includes("Chrome/")) return "Chrome";
  if (ua.includes("Firefox/")) return "Firefox";
  if (ua.includes("Safari/") && !ua.includes("Chrome")) return "Safari";
  if (ua.includes("OPR/") || ua.includes("Opera")) return "Opera";
  return "Otro";
}

/** Detecta si es móvil, tablet o desktop */
function parseDevice(ua: string): "mobile" | "tablet" | "desktop" {
  if (/Mobi|Android.*Mobile|iPhone|iPod/.test(ua)) return "mobile";
  if (/Tablet|iPad|Android(?!.*Mobile)/.test(ua)) return "tablet";
  return "desktop";
}

// ─── Mutation: registrar error ────────────────────────────────────────────────

export const logError = mutation({
  args: {
    page: v.string(),
    component: v.optional(v.string()),
    errorMessage: v.string(),
    errorStack: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    reportedByUser: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<void> => {
    // Intentar obtener datos del usuario autenticado (puede no estar logueado)
    let tokenIdentifier: string | undefined;
    let userName: string | undefined;
    let userEmail: string | undefined;

    try {
      const identity = await ctx.auth.getUserIdentity();
      if (identity) {
        tokenIdentifier = identity.tokenIdentifier;
        userName = identity.name;
        userEmail = identity.email;
      }
    } catch {
      // Silencioso — puede fallar si no hay sesión activa
    }

    const ua = args.userAgent ?? "";
    const browser = parseBrowser(ua);
    const deviceType = parseDevice(ua);

    await ctx.db.insert("errorLogs", {
      occurredAt: new Date().toISOString(),
      tokenIdentifier,
      userName,
      userEmail,
      page: args.page,
      component: args.component,
      errorMessage: args.errorMessage,
      errorStack: args.errorStack,
      userAgent: args.userAgent,
      browser,
      deviceType,
      reportedByUser: args.reportedByUser ?? false,
    });
  },
});

// ─── Queries: para el Back Office ────────────────────────────────────────────

export const list = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("errorLogs")
      .withIndex("by_occurred_at")
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    // Última hora de logs
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const recent = await ctx.db
      .query("errorLogs")
      .withIndex("by_occurred_at", (q) => q.gte("occurredAt", since))
      .collect();

    // Agrupar por navegador
    const byBrowser: Record<string, number> = {};
    const byDevice: Record<string, number> = {};
    const byPage: Record<string, number> = {};
    const byUser: Record<string, number> = {};
    let reportedCount = 0;

    for (const log of recent) {
      const browser = log.browser ?? "Desconocido";
      byBrowser[browser] = (byBrowser[browser] ?? 0) + 1;

      const device = log.deviceType ?? "desktop";
      byDevice[device] = (byDevice[device] ?? 0) + 1;

      byPage[log.page] = (byPage[log.page] ?? 0) + 1;

      const user = log.userEmail ?? log.tokenIdentifier ?? "Anónimo";
      byUser[user] = (byUser[user] ?? 0) + 1;

      if (log.reportedByUser) reportedCount++;
    }

    return {
      totalToday: recent.length,
      reportedByUser: reportedCount,
      byBrowser,
      byDevice,
      byPage,
      byUser,
    };
  },
});

export const clearAll = mutation({
  args: { adminToken: v.string() },
  handler: async (ctx, args): Promise<{ deleted: number }> => {
    // Verificar token de admin
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token", (q) => q.eq("token", args.adminToken))
      .first();
    if (!session) throw new Error("No autorizado");

    let deleted = 0;
    let batch = await ctx.db.query("errorLogs").take(200);
    while (batch.length > 0) {
      for (const doc of batch) {
        await ctx.db.delete(doc._id);
        deleted++;
      }
      batch = await ctx.db.query("errorLogs").take(200);
    }
    return { deleted };
  },
});
