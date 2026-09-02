/**
 * DICOM Equipment — Gestión de equipos médicos por empresa.
 * Aislado por companyId. Solo accesible para usuarios de la empresa.
 */
import { v, ConvexError } from "convex/values";
import { query, mutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function requireCompanyUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ message: "No autenticado", code: "UNAUTHENTICATED" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ message: "Usuario no encontrado", code: "NOT_FOUND" });
  if (!user.companyId) throw new ConvexError({ message: "Usuario sin empresa asignada", code: "FORBIDDEN" });
  return user;
}

async function requireCompanyAdmin(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const user = await requireCompanyUser(ctx);
  if (user.role !== "company_admin") {
    throw new ConvexError({ message: "Se requiere rol de administrador de empresa", code: "FORBIDDEN" });
  }
  return user;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/** Lista todos los equipos de la empresa del usuario autenticado */
export const list = query({
  args: {},
  handler: async (ctx): Promise<Doc<"dicomEquipment">[]> => {
    const user = await requireCompanyUser(ctx);
    return ctx.db
      .query("dicomEquipment")
      .withIndex("by_company", (q) => q.eq("companyId", user.companyId!))
      .collect();
  },
});

/** Obtiene un equipo por ID (verifica que pertenezca a la empresa del usuario) */
export const getById = query({
  args: { equipmentId: v.id("dicomEquipment") },
  handler: async (ctx, args): Promise<Doc<"dicomEquipment"> | null> => {
    const user = await requireCompanyUser(ctx);
    const equipment = await ctx.db.get(args.equipmentId);
    if (!equipment || equipment.companyId !== user.companyId) return null;
    return equipment;
  },
});

/** Estadísticas de equipos (para el dashboard) */
export const getStats = query({
  args: {},
  handler: async (ctx): Promise<{
    total: number;
    connected: number;
    unreachable: number;
    untested: number;
  }> => {
    const user = await requireCompanyUser(ctx);
    const all = await ctx.db
      .query("dicomEquipment")
      .withIndex("by_company", (q) => q.eq("companyId", user.companyId!))
      .collect();

    return {
      total: all.length,
      connected: all.filter((e) => e.connectionStatus === "connected").length,
      unreachable: all.filter((e) => e.connectionStatus === "unreachable" || e.connectionStatus === "error").length,
      untested: all.filter((e) => !e.connectionStatus || e.connectionStatus === "untested").length,
    };
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

/** Crear o actualizar un equipo */
export const upsert = mutation({
  args: {
    equipmentId: v.optional(v.id("dicomEquipment")),
    name: v.string(),
    modality: v.string(),
    aeTitle: v.optional(v.string()),
    ip: v.optional(v.string()),
    port: v.optional(v.string()),
    institution: v.optional(v.string()),
    location: v.optional(v.string()),
    manufacturer: v.optional(v.string()),
    model: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("inactive"), v.literal("maintenance")),
  },
  handler: async (ctx, args): Promise<Id<"dicomEquipment">> => {
    const user = await requireCompanyAdmin(ctx);
    const now = new Date().toISOString();
    const { equipmentId, ...fields } = args;

    if (equipmentId) {
      const existing = await ctx.db.get(equipmentId);
      if (!existing || existing.companyId !== user.companyId) {
        throw new ConvexError({ message: "Equipo no encontrado", code: "NOT_FOUND" });
      }
      await ctx.db.patch(equipmentId, { ...fields, updatedAt: now });
      return equipmentId;
    }

    return ctx.db.insert("dicomEquipment", {
      companyId: user.companyId!,
      ...fields,
      connectionStatus: "untested",
      studiesReceived: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Actualizar estado de conectividad (resultado de prueba de conexión) */
export const updateConnectionStatus = mutation({
  args: {
    equipmentId: v.id("dicomEquipment"),
    connectionStatus: v.union(
      v.literal("connected"),
      v.literal("unreachable"),
      v.literal("untested"),
      v.literal("error"),
    ),
    lastErrorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const user = await requireCompanyUser(ctx);
    const equipment = await ctx.db.get(args.equipmentId);
    if (!equipment || equipment.companyId !== user.companyId) {
      throw new ConvexError({ message: "Equipo no encontrado", code: "NOT_FOUND" });
    }
    const now = new Date().toISOString();
    await ctx.db.patch(args.equipmentId, {
      connectionStatus: args.connectionStatus,
      lastTestedAt: now,
      lastErrorMessage: args.lastErrorMessage,
      updatedAt: now,
      ...(args.connectionStatus === "connected" ? { lastCommunicationAt: now } : {}),
    });
  },
});

/** Registrar recepción de estudio desde un equipo */
export const recordStudyReceived = mutation({
  args: { equipmentId: v.id("dicomEquipment") },
  handler: async (ctx, args): Promise<void> => {
    const user = await requireCompanyUser(ctx);
    const equipment = await ctx.db.get(args.equipmentId);
    if (!equipment || equipment.companyId !== user.companyId) return;
    const now = new Date().toISOString();
    await ctx.db.patch(args.equipmentId, {
      lastStudyReceivedAt: now,
      lastCommunicationAt: now,
      connectionStatus: "connected",
      studiesReceived: (equipment.studiesReceived ?? 0) + 1,
      updatedAt: now,
    });
  },
});

/** Eliminar un equipo */
export const remove = mutation({
  args: { equipmentId: v.id("dicomEquipment") },
  handler: async (ctx, args): Promise<void> => {
    const user = await requireCompanyAdmin(ctx);
    const equipment = await ctx.db.get(args.equipmentId);
    if (!equipment || equipment.companyId !== user.companyId) {
      throw new ConvexError({ message: "Equipo no encontrado", code: "NOT_FOUND" });
    }
    await ctx.db.delete(args.equipmentId);
  },
});
