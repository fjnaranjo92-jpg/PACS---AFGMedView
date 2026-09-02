import { mutation, query } from "./_generated/server";
import { v, ConvexError } from "convex/values";

export const TERMS_VERSION = "2025-1";

/** Check if the current user (or anonymous session) has accepted the terms */
export const hasAccepted = query({
  args: { sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();

    // Authenticated user check
    if (identity) {
      const row = await ctx.db
        .query("termsAcceptances")
        .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
        .order("desc")
        .first();
      return row ? { accepted: true, acceptedAt: row.acceptedAt, version: row.version } : { accepted: false };
    }

    // Anonymous session check
    if (args.sessionToken) {
      const row = await ctx.db
        .query("termsAcceptances")
        .withIndex("by_token", (q) => q.eq("tokenIdentifier", args.sessionToken))
        .order("desc")
        .first();
      return row ? { accepted: true, acceptedAt: row.acceptedAt, version: row.version } : { accepted: false };
    }

    return { accepted: false };
  },
});

/** Record acceptance */
export const accept = mutation({
  args: { sessionToken: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const now = new Date().toISOString();

    if (identity) {
      // Look up userId
      const user = await ctx.db
        .query("users")
        .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
        .unique();

      await ctx.db.insert("termsAcceptances", {
        userId: user?._id,
        tokenIdentifier: identity.tokenIdentifier,
        acceptedAt: now,
        version: TERMS_VERSION,
      });
      return { ok: true };
    }

    if (args.sessionToken) {
      await ctx.db.insert("termsAcceptances", {
        tokenIdentifier: args.sessionToken,
        acceptedAt: now,
        version: TERMS_VERSION,
      });
      return { ok: true };
    }

    throw new ConvexError({ message: "No se puede registrar la aceptación sin identificación.", code: "BAD_REQUEST" });
  },
});

/** Send a contact message */
export const sendContact = mutation({
  args: {
    nombre: v.string(),
    email: v.string(),
    pais: v.string(),
    asunto: v.string(),
    mensaje: v.string(),
  },
  handler: async (ctx, args) => {
    if (!args.nombre.trim() || !args.email.trim() || !args.pais.trim() || !args.asunto.trim() || !args.mensaje.trim()) {
      throw new ConvexError({ message: "Todos los campos son obligatorios.", code: "BAD_REQUEST" });
    }
    await ctx.db.insert("contactMessages", {
      nombre: args.nombre.trim(),
      email: args.email.trim(),
      pais: args.pais.trim(),
      asunto: args.asunto.trim(),
      mensaje: args.mensaje.trim(),
      creadoEn: new Date().toISOString(),
      leido: false,
    });
    return { ok: true };
  },
});
