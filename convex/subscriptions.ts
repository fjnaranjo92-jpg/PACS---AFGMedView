import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

export const getMySubscription = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
  },
});

export const createOrUpdateSubscription = mutation({
  args: {
    status: v.union(v.literal("active"), v.literal("inactive"), v.literal("expired"), v.literal("pending")),
    paymentReference: v.optional(v.string()),
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
      .query("subscriptions")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    const now = new Date().toISOString();
    const expiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    if (existing) {
      await ctx.db.patch(existing._id, {
        status: args.status,
        startDate: now,
        expiryDate: expiry,
        ...(args.paymentReference && { paymentReference: args.paymentReference }),
      });
    } else {
      await ctx.db.insert("subscriptions", {
        userId: user._id,
        status: args.status,
        planName: "Plan Inicial",
        priceUsd: 3.99,
        startDate: now,
        expiryDate: expiry,
        ...(args.paymentReference && { paymentReference: args.paymentReference }),
      });
    }
  },
});
