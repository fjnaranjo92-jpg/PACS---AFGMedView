/**
 * PACS Piloto — Queries y Mutations (Convex V8 runtime)
 * Las acciones que llaman a Orthanc están en pacs.ts (Node runtime).
 */
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// ─── Auditoría PACS ────────────────────────────────────────────────────────────

export const logPacsAction = mutation({
  args: {
    action: v.union(
      v.literal("consulted_study"),
      v.literal("opened_study"),
      v.literal("viewed_study"),
      v.literal("connectivity_test"),
    ),
    studyInstanceUid: v.optional(v.string()),
    details: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    await ctx.db.insert("pacsAuditLog", {
      occurredAt: new Date().toISOString(),
      tokenIdentifier: identity?.tokenIdentifier,
      userName: identity?.name,
      action: args.action,
      studyInstanceUid: args.studyInstanceUid,
      details: args.details,
    });
  },
});

export const getPacsAuditLog = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = args.limit ?? 100;
    return await ctx.db
      .query("pacsAuditLog")
      .withIndex("by_occurred_at")
      .order("desc")
      .take(limit);
  },
});
