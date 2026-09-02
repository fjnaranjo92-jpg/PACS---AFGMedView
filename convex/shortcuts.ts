import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { ConvexError } from "convex/values";

const PROFILE_TYPE_VALIDATOR = v.union(
  v.literal("general"),
  v.literal("radiologia"),
  v.literal("mamografia"),
  v.literal("ecografia"),
  v.literal("tomografia"),
  v.literal("resonancia"),
  v.literal("personalizado")
);

/** Get all shortcut profiles for the current user */
export const listProfiles = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ message: "User not logged in", code: "UNAUTHENTICATED" });
    }
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return [];
    return await ctx.db
      .query("shortcutProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
  },
});

/** Get the active profile for the current user */
export const getActiveProfile = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;
    const profiles = await ctx.db
      .query("shortcutProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    return profiles.find((p) => p.isActive) ?? null;
  },
});

/** Save or create a shortcut profile */
export const saveProfile = mutation({
  args: {
    profileId: v.optional(v.id("shortcutProfiles")),
    profileName: v.string(),
    profileType: PROFILE_TYPE_VALIDATOR,
    shortcuts: v.string(),
    setActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ message: "User not logged in", code: "UNAUTHENTICATED" });
    }
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) {
      throw new ConvexError({ message: "User not found", code: "NOT_FOUND" });
    }

    const now = new Date().toISOString();

    // If setActive, deactivate all other profiles first
    if (args.setActive) {
      const profiles = await ctx.db
        .query("shortcutProfiles")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
      for (const p of profiles) {
        if (p.isActive) {
          await ctx.db.patch(p._id, { isActive: false });
        }
      }
    }

    if (args.profileId) {
      // Update existing
      const existing = await ctx.db.get(args.profileId);
      if (!existing || existing.userId !== user._id) {
        throw new ConvexError({ message: "Profile not found", code: "NOT_FOUND" });
      }
      await ctx.db.patch(args.profileId, {
        profileName: args.profileName,
        profileType: args.profileType,
        shortcuts: args.shortcuts,
        isActive: args.setActive,
        updatedAt: now,
      });
      return args.profileId;
    } else {
      // Create new
      return await ctx.db.insert("shortcutProfiles", {
        userId: user._id,
        profileName: args.profileName,
        profileType: args.profileType,
        shortcuts: args.shortcuts,
        isActive: args.setActive,
        updatedAt: now,
      });
    }
  },
});

/** Delete a shortcut profile */
export const deleteProfile = mutation({
  args: { profileId: v.id("shortcutProfiles") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ message: "User not logged in", code: "UNAUTHENTICATED" });
    }
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) {
      throw new ConvexError({ message: "User not found", code: "NOT_FOUND" });
    }
    const profile = await ctx.db.get(args.profileId);
    if (!profile || profile.userId !== user._id) {
      throw new ConvexError({ message: "Profile not found", code: "NOT_FOUND" });
    }
    await ctx.db.delete(args.profileId);
  },
});

/** Set a profile as active (deactivates others) */
export const setActiveProfile = mutation({
  args: { profileId: v.id("shortcutProfiles") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ message: "User not logged in", code: "UNAUTHENTICATED" });
    }
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) {
      throw new ConvexError({ message: "User not found", code: "NOT_FOUND" });
    }
    const target = await ctx.db.get(args.profileId);
    if (!target || target.userId !== user._id) {
      throw new ConvexError({ message: "Profile not found", code: "NOT_FOUND" });
    }

    // Deactivate all others
    const profiles = await ctx.db
      .query("shortcutProfiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    for (const p of profiles) {
      if (p._id === args.profileId) {
        await ctx.db.patch(p._id, { isActive: true });
      } else if (p.isActive) {
        await ctx.db.patch(p._id, { isActive: false });
      }
    }
  },
});
