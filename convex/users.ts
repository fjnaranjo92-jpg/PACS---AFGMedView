import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";

export const updateCurrentUser = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const existing = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name: identity.name ?? existing.name,
        email: identity.email ?? existing.email,
      });
      // Apply any pending company invitation for this user
      if (identity.email && !existing.companyId) {
        await ctx.runMutation(internal.companies.applyPendingInvitationInternal, {
          email: identity.email,
          userId: existing._id,
        });
      }
      return existing._id;
    }

    const userId = await ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name: identity.name,
      email: identity.email,
    });

    // Apply any pending invitation for this new user
    if (identity.email) {
      await ctx.runMutation(internal.companies.applyPendingInvitationInternal, {
        email: identity.email,
        userId,
      });
    }

    return userId;
  },
});

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
  },
});

/**
 * Apply registration intent saved in localStorage during sign-up flow.
 * Called from the auth callback after the user is authenticated.
 * Updates user profile fields (name, lastName, country) if not already set.
 */
export const applyRegistrationIntent = mutation({
  args: {
    name: v.optional(v.string()),
    lastName: v.optional(v.string()),
    country: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;

    const patch: Partial<{ name: string; lastName: string; country: string }> = {};
    if (args.name && !user.name) patch.name = args.name;
    if (args.lastName && !user.lastName) patch.lastName = args.lastName;
    if (args.country && !user.country) patch.country = args.country;

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(user._id, patch);
    }
    return user._id;
  },
});

/**
 * Returns the redirect destination based on the authenticated user's role/profile.
 * Used after login to route users to the correct section of the app.
 */
export const getMyRedirectProfile = query({
  args: {},
  handler: async (ctx): Promise<{ redirect: "empresa" | "dashboard" | "admin" | "landing" } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();

    if (!user) return { redirect: "landing" };

    // Check superadmin via settings table
    const superAdminSetting = await ctx.db
      .query("settings")
      .withIndex("by_key", (q) => q.eq("key", "superAdminEmail"))
      .unique();
    if (superAdminSetting && user.email && user.email === superAdminSetting.value) {
      return { redirect: "admin" };
    }

    // Company user (any company role)
    if (user.companyId) return { redirect: "empresa" };

    // Independent user with explicit role
    if (user.role === "independent") return { redirect: "dashboard" };

    // User without company and without defined role → landing (needs to complete registration/activate plan)
    return { redirect: "landing" };
  },
});

export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    lastName: v.optional(v.string()),
    country: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ message: "No autenticado", code: "UNAUTHENTICATED" });

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError({ message: "Usuario no encontrado", code: "NOT_FOUND" });

    await ctx.db.patch(user._id, {
      ...(args.name !== undefined && { name: args.name }),
      ...(args.lastName !== undefined && { lastName: args.lastName }),
      ...(args.country !== undefined && { country: args.country }),
    });
  },
});
