/**
 * Enterprise requests — solicitudes de implementación del plan MEDVIEW EMPRESA.
 * Enviadas desde la landing page. Gestionadas desde Back Office.
 */
import { v } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { Doc } from "./_generated/dataModel.d.ts";

/** Lista todas las solicitudes (solo Back Office) */
export const list = query({
  args: { status: v.optional(v.string()) },
  handler: async (ctx, args): Promise<Doc<"enterpriseRequests">[]> => {
    if (args.status) {
      return ctx.db
        .query("enterpriseRequests")
        .withIndex("by_status", (q) =>
          q.eq(
            "status",
            args.status as
              | "pending"
              | "reviewing"
              | "contacted"
              | "closed",
          ),
        )
        .order("desc")
        .collect();
    }
    return ctx.db
      .query("enterpriseRequests")
      .withIndex("by_created_at")
      .order("desc")
      .collect();
  },
});

/** Crear nueva solicitud — llamada desde la landing */
export const create = mutation({
  args: {
    companyName: v.string(),
    contactName: v.string(),
    contactEmail: v.string(),
    phone: v.optional(v.string()),
    estimatedUsers: v.optional(v.number()),
    estimatedStudies: v.optional(v.string()),
    city: v.optional(v.string()),
    country: v.optional(v.string()),
    observations: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.insert("enterpriseRequests", {
      ...args,
      status: "pending",
      createdAt: new Date().toISOString(),
    });
  },
});

/** Actualizar estado y notas de una solicitud (Back Office) */
export const update = mutation({
  args: {
    id: v.id("enterpriseRequests"),
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("reviewing"),
        v.literal("contacted"),
        v.literal("closed"),
      ),
    ),
    adminNotes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const { id, ...rest } = args;
    await ctx.db.patch(id, { ...rest, updatedAt: new Date().toISOString() });
  },
});
