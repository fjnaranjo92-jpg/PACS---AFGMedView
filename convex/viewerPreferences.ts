import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";

/** Obtener preferencias del usuario actual */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;

    const prefs = await ctx.db
      .query("viewerPreferences")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    return prefs ?? null;
  },
});

/** Guardar preferencias del usuario (upsert) */
export const save = mutation({
  args: {
    iconSize: v.optional(v.union(v.literal("sm"), v.literal("md"), v.literal("lg"))),
    showLabels: v.optional(v.boolean()),
    panelExpanded: v.optional(v.boolean()),
    editorPosition: v.optional(v.union(v.literal("bottom"), v.literal("right"))),
    editorHeight: v.optional(v.number()),
    colorTheme: v.optional(v.union(v.literal("dark"), v.literal("darker"), v.literal("slate"))),
    showSeriesStrip: v.optional(v.boolean()),
    showBottomPanel: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ message: "No autenticado", code: "UNAUTHENTICATED" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError({ message: "Usuario no encontrado", code: "NOT_FOUND" });

    const existing = await ctx.db
      .query("viewerPreferences")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();

    const now = new Date().toISOString();

    if (existing) {
      await ctx.db.patch(existing._id, { ...args, updatedAt: now });
    } else {
      await ctx.db.insert("viewerPreferences", {
        userId: user._id,
        ...args,
        updatedAt: now,
      });
    }
  },
});
