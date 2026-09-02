/**
 * PACS configuration per company.
 * Each company has its own isolated PACS config.
 * Credentials (password, apiKey) are stored server-side only and NEVER returned to the client.
 */
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import { ConvexError } from "convex/values";
import type { Id } from "./_generated/dataModel.d.ts";

type SafePacsConfig = {
  _id: Id<"companyPacsConfig">;
  _creationTime: number;
  companyId: Id<"companies">;
  pacsName?: string;
  orthancHost?: string;
  orthancPort?: string;
  orthancUrl?: string;
  dicomWebUrl?: string;
  aeTitle?: string;
  username?: string;
  /** Never the real password — just whether one is set */
  hasPassword: boolean;
  hasApiKey: boolean;
  useHttps?: boolean;
  localFolderEnabled?: boolean;
  status: "pending" | "active" | "error" | "disabled";
  lastConnectionStatus?: string;
  lastTestedAt?: string;
  updatedAt: string;
};

/** Get PACS config for a company — safe (no credentials returned) */
export const getByCompany = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args): Promise<SafePacsConfig | null> => {
    const config = await ctx.db
      .query("companyPacsConfig")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .unique();
    if (!config) return null;
    const { password: _pw, apiKey: _ak, ...safe } = config;
    return {
      ...safe,
      hasPassword: !!_pw,
      hasApiKey: !!_ak,
    };
  },
});

/** Save or update PACS config for a company */
export const save = mutation({
  args: {
    companyId: v.id("companies"),
    pacsName: v.optional(v.string()),
    orthancHost: v.optional(v.string()),
    orthancPort: v.optional(v.string()),
    orthancUrl: v.optional(v.string()),
    dicomWebUrl: v.optional(v.string()),
    aeTitle: v.optional(v.string()),
    username: v.optional(v.string()),
    /** Only update password if non-empty string provided */
    password: v.optional(v.string()),
    /** Only update apiKey if non-empty string provided */
    apiKey: v.optional(v.string()),
    useHttps: v.optional(v.boolean()),
    localFolderEnabled: v.optional(v.boolean()),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("active"),
        v.literal("error"),
        v.literal("disabled"),
      ),
    ),
    lastConnectionStatus: v.optional(v.string()),
    lastTestedAt: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const { companyId, password, apiKey, ...rest } = args;

    const existing = await ctx.db
      .query("companyPacsConfig")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .unique();

    const updates: Record<string, unknown> = {
      ...rest,
      updatedAt: new Date().toISOString(),
    };

    // Only update password if a non-empty string is provided
    if (password && password.trim().length > 0) {
      updates.password = password;
    }
    if (apiKey && apiKey.trim().length > 0) {
      updates.apiKey = apiKey;
    }

    if (existing) {
      await ctx.db.patch(existing._id, updates);
    } else {
      await ctx.db.insert("companyPacsConfig", {
        companyId,
        status: "pending",
        updatedAt: new Date().toISOString(),
        ...updates,
      });
    }
  },
});

/** Get PACS config for the authenticated user's company */
export const getMyCompanyPacs = query({
  args: {},
  handler: async (ctx): Promise<SafePacsConfig | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user?.companyId) return null;
    const config = await ctx.db
      .query("companyPacsConfig")
      .withIndex("by_company", (q) => q.eq("companyId", user.companyId!))
      .unique();
    if (!config) return null;
    const { password: _pw, apiKey: _ak, ...safe } = config;
    return { ...safe, hasPassword: !!_pw, hasApiKey: !!_ak };
  },
});

/** Save PACS config for the authenticated user's company */
export const saveMyCompanyPacs = mutation({
  args: {
    pacsName: v.optional(v.string()),
    orthancHost: v.optional(v.string()),
    orthancPort: v.optional(v.string()),
    orthancUrl: v.optional(v.string()),
    dicomWebUrl: v.optional(v.string()),
    aeTitle: v.optional(v.string()),
    username: v.optional(v.string()),
    password: v.optional(v.string()),
    apiKey: v.optional(v.string()),
    useHttps: v.optional(v.boolean()),
    localFolderEnabled: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<void> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ message: "No autenticado", code: "UNAUTHENTICATED" });
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user?.companyId) throw new ConvexError({ message: "Sin empresa", code: "FORBIDDEN" });
    if (user.role !== "company_admin") throw new ConvexError({ message: "Se requiere administrador", code: "FORBIDDEN" });

    const { password, apiKey, ...rest } = args;
    const existing = await ctx.db
      .query("companyPacsConfig")
      .withIndex("by_company", (q) => q.eq("companyId", user.companyId!))
      .unique();

    const updates: Record<string, unknown> = { ...rest, updatedAt: new Date().toISOString() };
    if (password && password.trim()) updates.password = password;
    if (apiKey && apiKey.trim()) updates.apiKey = apiKey;

    if (existing) {
      await ctx.db.patch(existing._id, updates);
    } else {
      await ctx.db.insert("companyPacsConfig", {
        companyId: user.companyId!,
        status: "pending",
        updatedAt: new Date().toISOString(),
        ...updates,
      });
    }
  },
});

/** Update connection test result */
export const updateConnectionStatus = mutation({
  args: {
    companyId: v.id("companies"),
    status: v.union(
      v.literal("pending"),
      v.literal("active"),
      v.literal("error"),
      v.literal("disabled"),
    ),
    lastConnectionStatus: v.string(),
  },
  handler: async (ctx, args): Promise<void> => {
    const existing = await ctx.db
      .query("companyPacsConfig")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .unique();
    if (!existing) {
      throw new ConvexError({ code: "NOT_FOUND", message: "PACS config not found" });
    }
    await ctx.db.patch(existing._id, {
      status: args.status,
      lastConnectionStatus: args.lastConnectionStatus,
      lastTestedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  },
});
