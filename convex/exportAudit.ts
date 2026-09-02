/**
 * Backend de Auditoría de Exportaciones.
 * Registra cada descarga con marca de agua. Módulo independiente.
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";

// ─── Registrar exportación (llamado desde el cliente al descargar) ─────────

export const logExport = mutation({
  args: {
    fileType: v.string(),
    patientName: v.string(),
    patientId: v.string(),
    studyDate: v.string(),
    studyDescription: v.string(),
    institution: v.string(),
    watermarkConfigSnapshot: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ message: "No autenticado", code: "UNAUTHENTICATED" });
    }

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (!user) {
      throw new ConvexError({ message: "Usuario no encontrado", code: "NOT_FOUND" });
    }

    await ctx.db.insert("exportAudit", {
      userId: user._id,
      userName: user.name ?? identity.name ?? undefined,
      userEmail: user.email ?? identity.email ?? undefined,
      exportedAt: new Date().toISOString(),
      fileType: args.fileType,
      patientName: args.patientName,
      patientId: args.patientId,
      studyDate: args.studyDate,
      studyDescription: args.studyDescription,
      institution: args.institution,
      watermarkConfigSnapshot: args.watermarkConfigSnapshot,
    });
  },
});

// ─── Listar auditoría (admin) ─────────────────────────────────────────────

export const adminListExports = query({
  args: {
    token: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    id: string;
    userName: string;
    userEmail: string;
    exportedAt: string;
    fileType: string;
    patientName: string;
    patientId: string;
    studyDate: string;
    institution: string;
  }[]> => {
    // Validar token admin
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!session) {
      throw new ConvexError({ message: "No autorizado", code: "FORBIDDEN" });
    }

    const limit = args.limit ?? 100;
    const records = await ctx.db
      .query("exportAudit")
      .withIndex("by_exported_at")
      .order("desc")
      .take(limit);

    return records.map((r) => ({
      id: r._id,
      userName: r.userName ?? "—",
      userEmail: r.userEmail ?? "—",
      exportedAt: r.exportedAt,
      fileType: r.fileType,
      patientName: r.patientName,
      patientId: r.patientId,
      studyDate: r.studyDate,
      institution: r.institution,
    }));
  },
});

// ─── Estadísticas rápidas ────────────────────────────────────────────────

export const adminExportStats = query({
  args: { token: v.string() },
  handler: async (ctx, args): Promise<{
    total: number;
    byType: Record<string, number>;
  }> => {
    const session = await ctx.db
      .query("adminSessions")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .unique();
    if (!session) {
      throw new ConvexError({ message: "No autorizado", code: "FORBIDDEN" });
    }

    const records = await ctx.db.query("exportAudit").order("desc").take(500);
    const byType: Record<string, number> = {};
    for (const r of records) {
      byType[r.fileType] = (byType[r.fileType] ?? 0) + 1;
    }

    return { total: records.length, byType };
  },
});
