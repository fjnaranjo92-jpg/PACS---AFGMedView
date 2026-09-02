import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { ConvexError } from "convex/values";

export const getMyBillingData = query({
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
      .query("billingData")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
  },
});

export const saveBillingData = mutation({
  args: {
    nombres: v.optional(v.string()),
    apellidos: v.optional(v.string()),
    razonSocial: v.string(),
    identificacion: v.string(),
    ruc: v.optional(v.string()),
    emailFactura: v.string(),
    telefono: v.optional(v.string()),
    direccion: v.string(),
    ciudad: v.string(),
    provinciaEstado: v.string(),
    pais: v.string(),
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
      .query("billingData")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("billingData", { userId: user._id, ...args });
    }
  },
});

// ─── Voucher upload ───────────────────────────────────────────────────────────

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ message: "No autenticado", code: "UNAUTHENTICATED" });
    return await ctx.storage.generateUploadUrl();
  },
});

export const saveVoucher = mutation({
  args: {
    storageId: v.string(),
    fileName: v.string(),
    fileType: v.string(),
    planType: v.string(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ message: "No autenticado", code: "UNAUTHENTICATED" });
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) throw new ConvexError({ message: "Usuario no encontrado", code: "NOT_FOUND" });

    await ctx.db.insert("paymentVouchers", {
      userId: user._id,
      planType: args.planType,
      storageId: args.storageId,
      fileName: args.fileName,
      fileType: args.fileType,
      uploadedAt: new Date().toISOString(),
      status: "pending",
      invoiceStatus: "pending",
    });
  },
});

export const getVoucherUrl = query({
  args: { storageId: v.string() },
  handler: async (ctx, args): Promise<string | null> => {
    return await ctx.storage.getUrl(args.storageId);
  },
});

export const getVoucherUrlById = mutation({
  args: { voucherId: v.id("paymentVouchers") },
  handler: async (ctx, args): Promise<string | null> => {
    const voucher = await ctx.db.get(args.voucherId);
    if (!voucher) return null;
    return await ctx.storage.getUrl(voucher.storageId);
  },
});
