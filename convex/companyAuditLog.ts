/**
 * Company Audit Log — Auditoría de acciones dentro del espacio empresarial.
 * Aislado por companyId. Accesible para company_admin.
 */
import { v, ConvexError } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";
import { paginationOptsValidator } from "convex/server";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function requireCompanyAdmin(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ message: "No autenticado", code: "UNAUTHENTICATED" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ message: "Usuario no encontrado", code: "NOT_FOUND" });
  if (user.role !== "company_admin" || !user.companyId) {
    throw new ConvexError({ message: "Se requiere administrador de empresa", code: "FORBIDDEN" });
  }
  return user;
}

async function requireCompanyUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ message: "No autenticado", code: "UNAUTHENTICATED" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ message: "Usuario no encontrado", code: "NOT_FOUND" });
  if (!user.companyId) throw new ConvexError({ message: "Sin empresa asignada", code: "FORBIDDEN" });
  return user;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

/** Lista los logs de auditoría de la empresa (paginado, admin only) */
export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    action: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    page: Doc<"companyAuditLog">[];
    isDone: boolean;
    continueCursor: string;
  }> => {
    const user = await requireCompanyAdmin(ctx);
    const q = ctx.db
      .query("companyAuditLog")
      .withIndex("by_company_and_occurred_at", (qi) =>
        qi.eq("companyId", user.companyId!)
      )
      .order("desc");

    const result = await q.paginate(args.paginationOpts);
    const page = args.action
      ? result.page.filter((r) => r.action === args.action)
      : result.page;

    return { ...result, page };
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

/** Registrar una acción de auditoría */
export const insert = mutation({
  args: {
    action: v.string(),
    detail: v.optional(v.string()),
    studyUid: v.optional(v.string()),
    patientName: v.optional(v.string()),
    equipmentName: v.optional(v.string()),
    result: v.optional(v.union(v.literal("success"), v.literal("error"), v.literal("info"))),
  },
  handler: async (ctx, args): Promise<Id<"companyAuditLog">> => {
    const user = await requireCompanyUser(ctx);
    const identity = await ctx.auth.getUserIdentity();
    const userName = [user.name, user.lastName].filter(Boolean).join(" ") || user.email || "Usuario";

    return ctx.db.insert("companyAuditLog", {
      companyId: user.companyId!,
      tokenIdentifier: identity?.tokenIdentifier,
      userName,
      action: args.action,
      detail: args.detail,
      studyUid: args.studyUid,
      patientName: args.patientName,
      equipmentName: args.equipmentName,
      result: args.result ?? "info",
      occurredAt: new Date().toISOString(),
    });
  },
});

/** Internal: registrar auditoría sin requerir autenticación (para mutaciones internas) */
export const insertInternal = internalMutation({
  args: {
    companyId: v.id("companies"),
    tokenIdentifier: v.optional(v.string()),
    userName: v.optional(v.string()),
    action: v.string(),
    detail: v.optional(v.string()),
    studyUid: v.optional(v.string()),
    patientName: v.optional(v.string()),
    equipmentName: v.optional(v.string()),
    result: v.optional(v.union(v.literal("success"), v.literal("error"), v.literal("info"))),
  },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.insert("companyAuditLog", {
      companyId: args.companyId,
      tokenIdentifier: args.tokenIdentifier,
      userName: args.userName,
      action: args.action,
      detail: args.detail,
      studyUid: args.studyUid,
      patientName: args.patientName,
      equipmentName: args.equipmentName,
      result: args.result ?? "info",
      occurredAt: new Date().toISOString(),
    });
  },
});
