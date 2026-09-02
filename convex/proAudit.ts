/**
 * Backend de Auditoría PRO del Visor DICOM.
 * Registra eventos de sesión (mediciones, anotaciones, exportaciones, edición de metadatos).
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";

const EVENT_TYPES = v.union(
  v.literal("study_opened"),
  v.literal("meta_edited"),
  v.literal("measurement_added"),
  v.literal("measurement_cleared"),
  v.literal("roi_added"),
  v.literal("roi_cleared"),
  v.literal("annotation_added"),
  v.literal("annotation_cleared"),
  v.literal("export_pro"),
  v.literal("export_report"),
  v.literal("compare_opened"),
);

// ─── Registrar evento ─────────────────────────────────────────────────────────

export const logEvent = mutation({
  args: {
    sessionId: v.string(),
    eventType: EVENT_TYPES,
    occurredAt: v.string(),
    payload: v.optional(v.string()),
    studyInfo: v.optional(v.string()),
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

    await ctx.db.insert("proAudit", {
      userId: user._id,
      sessionId: args.sessionId,
      eventType: args.eventType,
      occurredAt: args.occurredAt,
      payload: args.payload,
      studyInfo: args.studyInfo,
    });
  },
});

// ─── Listar eventos del usuario autenticado ───────────────────────────────────

export const getMyEvents = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<{
    id: string;
    sessionId: string;
    eventType: string;
    occurredAt: string;
    payload: string | null;
    studyInfo: string | null;
  }[]> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (!user) return [];

    const limit = Math.min(args.limit ?? 100, 200);
    const records = await ctx.db
      .query("proAudit")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(limit);

    return records.map((r) => ({
      id: r._id,
      sessionId: r.sessionId,
      eventType: r.eventType,
      occurredAt: r.occurredAt,
      payload: r.payload ?? null,
      studyInfo: r.studyInfo ?? null,
    }));
  },
});
