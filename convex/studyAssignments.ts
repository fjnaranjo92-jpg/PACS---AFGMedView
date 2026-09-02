/**
 * Study Assignments — Asignación de estudios a médicos.
 * Permite a admins/técnicos asignar estudios DICOM a médicos para informar.
 */
import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ message: "No autenticado", code: "UNAUTHENTICATED" });
  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ message: "Usuario no encontrado", code: "NOT_FOUND" });
  return user;
}

async function requireAssigner(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "company_admin" && user.role !== "tecnico") {
    throw new ConvexError({ message: "Acceso denegado — se requiere rol de administrador o técnico", code: "FORBIDDEN" });
  }
  if (!user.companyId) {
    throw new ConvexError({ message: "Sin empresa asignada", code: "FORBIDDEN" });
  }
  return user;
}

async function requireCompanyAdmin(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "company_admin") {
    throw new ConvexError({ message: "Acceso denegado — se requiere rol de administrador", code: "FORBIDDEN" });
  }
  if (!user.companyId) {
    throw new ConvexError({ message: "Sin empresa asignada", code: "FORBIDDEN" });
  }
  return user;
}

// ─── Mutations ────────────────────────────────────────────────────────────────

/** Create a new study assignment (company_admin or tecnico) */
export const assign = mutation({
  args: {
    studyId: v.optional(v.id("worklistStudies")),
    studyInstanceUid: v.optional(v.string()),
    patientName: v.optional(v.string()),
    assignedTo: v.id("users"),
    priority: v.union(v.literal("normal"), v.literal("urgente"), v.literal("critico")),
    dueDate: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"studyAssignments">> => {
    const user = await requireAssigner(ctx);
    const companyId = user.companyId!;

    // Verify the target doctor belongs to the same company
    const doctor = await ctx.db.get(args.assignedTo);
    if (!doctor) throw new ConvexError({ message: "Médico no encontrado", code: "NOT_FOUND" });
    if (doctor.companyId !== companyId) {
      throw new ConvexError({ message: "El médico no pertenece a esta empresa", code: "FORBIDDEN" });
    }

    const now = new Date().toISOString();
    const id = await ctx.db.insert("studyAssignments", {
      companyId,
      studyId: args.studyId,
      studyInstanceUid: args.studyInstanceUid,
      patientName: args.patientName,
      assignedTo: args.assignedTo,
      assignedBy: user._id,
      priority: args.priority,
      status: "pending",
      dueDate: args.dueDate,
      notes: args.notes,
      assignedAt: now,
      updatedAt: now,
    });
    return id;
  },
});

/** Update status of an assignment (doctor can update their own) */
export const updateStatus = mutation({
  args: {
    assignmentId: v.id("studyAssignments"),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
  },
  handler: async (ctx, args): Promise<void> => {
    const user = await requireUser(ctx);
    const assignment = await ctx.db.get(args.assignmentId);
    if (!assignment) throw new ConvexError({ message: "Asignación no encontrada", code: "NOT_FOUND" });

    // Only the assigned doctor or company admin can update
    const isAssignedDoctor = assignment.assignedTo === user._id;
    const isAdmin = user.role === "company_admin" && user.companyId === assignment.companyId;
    if (!isAssignedDoctor && !isAdmin) {
      throw new ConvexError({ message: "No tiene permisos para actualizar esta asignación", code: "FORBIDDEN" });
    }

    await ctx.db.patch(args.assignmentId, {
      status: args.status,
      updatedAt: new Date().toISOString(),
    });
  },
});

// ─── Queries ──────────────────────────────────────────────────────────────────

/** Get all assignments for a company (company_admin only) */
export const getCompanyAssignments = query({
  args: {},
  handler: async (ctx): Promise<Array<Doc<"studyAssignments"> & { doctorName: string; assignedByName: string }>> => {
    const user = await requireCompanyAdmin(ctx);
    const companyId = user.companyId!;

    const assignments = await ctx.db
      .query("studyAssignments")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .order("desc")
      .take(100);

    // Enrich with doctor and assigner names
    const enriched = await Promise.all(
      assignments.map(async (a) => {
        const doctor = await ctx.db.get(a.assignedTo);
        const assigner = await ctx.db.get(a.assignedBy);
        const doctorName = doctor
          ? [doctor.name, doctor.lastName].filter(Boolean).join(" ") || doctor.email || "Sin nombre"
          : "Desconocido";
        const assignedByName = assigner
          ? [assigner.name, assigner.lastName].filter(Boolean).join(" ") || assigner.email || "Sin nombre"
          : "Desconocido";
        return { ...a, doctorName, assignedByName };
      })
    );

    return enriched;
  },
});

/** Get assignments for the current user (assigned to me) */
export const getMyAssignments = query({
  args: {},
  handler: async (ctx): Promise<Array<Doc<"studyAssignments"> & { assignedByName: string }>> => {
    const user = await requireUser(ctx);

    const assignments = await ctx.db
      .query("studyAssignments")
      .withIndex("by_assigned_to", (q) => q.eq("assignedTo", user._id))
      .order("desc")
      .take(50);

    const enriched = await Promise.all(
      assignments.map(async (a) => {
        const assigner = await ctx.db.get(a.assignedBy);
        const assignedByName = assigner
          ? [assigner.name, assigner.lastName].filter(Boolean).join(" ") || assigner.email || "Sin nombre"
          : "Desconocido";
        return { ...a, assignedByName };
      })
    );

    return enriched;
  },
});
