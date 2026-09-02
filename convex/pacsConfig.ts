/**
 * pacsConfig — Queries y Mutations para la configuración PACS/DICOM.
 * Almacena los parámetros de conexión (Orthanc, DICOMweb, carpeta local, etc.)
 * por usuario en la tabla pacsConfig.
 */
import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";

// ─── Helper ────────────────────────────────────────────────────────────────────

async function requireUser(ctx: QueryCtx | MutationCtx) {
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
  return user;
}

// ─── Query ─────────────────────────────────────────────────────────────────────

export const get = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const config = await ctx.db
      .query("pacsConfig")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (!config) return null;
    // Never expose password in query
    return {
      _id: config._id,
      pacsName: config.pacsName ?? "",
      localFolderPath: config.localFolderPath ?? "",
      orthancHost: config.orthancHost ?? "",
      orthancPort: config.orthancPort ?? "8042",
      orthancUrl: config.orthancUrl ?? "",
      dicomWebUrl: config.dicomWebUrl ?? "",
      aeTitle: config.aeTitle ?? "AFGMEDVIEW",
      modalityIp: config.modalityIp ?? "",
      dicomPort: config.dicomPort ?? "4242",
      apiKey: config.apiKey ?? "",
      username: config.username ?? "",
      hasPassword: !!config.password,
      useHttps: config.useHttps ?? false,
      updatedAt: config.updatedAt,
    };
  },
});

// ─── Mutation ──────────────────────────────────────────────────────────────────

export const save = mutation({
  args: {
    pacsName: v.optional(v.string()),
    localFolderPath: v.optional(v.string()),
    orthancHost: v.optional(v.string()),
    orthancPort: v.optional(v.string()),
    orthancUrl: v.optional(v.string()),
    dicomWebUrl: v.optional(v.string()),
    aeTitle: v.optional(v.string()),
    modalityIp: v.optional(v.string()),
    dicomPort: v.optional(v.string()),
    apiKey: v.optional(v.string()),
    username: v.optional(v.string()),
    password: v.optional(v.string()),
    useHttps: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const now = new Date().toISOString();
    const existing = await ctx.db
      .query("pacsConfig")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    const data = {
      pacsName: args.pacsName,
      localFolderPath: args.localFolderPath,
      orthancHost: args.orthancHost,
      orthancPort: args.orthancPort,
      orthancUrl: args.orthancUrl,
      dicomWebUrl: args.dicomWebUrl,
      aeTitle: args.aeTitle,
      modalityIp: args.modalityIp,
      dicomPort: args.dicomPort,
      apiKey: args.apiKey,
      username: args.username,
      useHttps: args.useHttps,
      updatedAt: now,
    };

    if (existing) {
      // Only update password if provided
      const update = args.password
        ? { ...data, password: args.password }
        : data;
      await ctx.db.patch(existing._id, update);
      return existing._id;
    }

    return await ctx.db.insert("pacsConfig", {
      userId: user._id,
      ...data,
      ...(args.password ? { password: args.password } : {}),
    });
  },
});
