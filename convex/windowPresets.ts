/**
 * windowPresets — queries y mutations para presets personalizados de WL por usuario.
 */
import { query, mutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { v, ConvexError } from "convex/values";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getCurrentUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ message: "No autenticado", code: "UNAUTHENTICATED" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ message: "Usuario no encontrado", code: "NOT_FOUND" });
  return user;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export const listByUser = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    return await ctx.db
      .query("windowPresets")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    label: v.string(),
    wc: v.number(),
    ww: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    // Count existing to set sort order
    const existing = await ctx.db
      .query("windowPresets")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    const sortOrder = existing.length;
    return await ctx.db.insert("windowPresets", {
      userId: user._id,
      label: args.label.trim(),
      wc: args.wc,
      ww: Math.max(1, args.ww),
      sortOrder,
      createdAt: new Date().toISOString(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("windowPresets"),
    label: v.string(),
    wc: v.number(),
    ww: v.number(),
  },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const preset = await ctx.db.get(args.id);
    if (!preset) throw new ConvexError({ message: "Preset no encontrado", code: "NOT_FOUND" });
    if (preset.userId !== user._id) throw new ConvexError({ message: "Sin permiso", code: "FORBIDDEN" });
    await ctx.db.patch(args.id, {
      label: args.label.trim(),
      wc: args.wc,
      ww: Math.max(1, args.ww),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("windowPresets") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    const preset = await ctx.db.get(args.id);
    if (!preset) throw new ConvexError({ message: "Preset no encontrado", code: "NOT_FOUND" });
    if (preset.userId !== user._id) throw new ConvexError({ message: "Sin permiso", code: "FORBIDDEN" });
    await ctx.db.delete(args.id);
  },
});
