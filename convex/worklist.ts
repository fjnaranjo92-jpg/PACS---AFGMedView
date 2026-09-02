/**
 * Worklist — Módulo INFORMAR
 *
 * Queries y Mutations para la bandeja de estudios DICOM pendientes de informar.
 * Completamente independiente del módulo de informes IA (aiReports).
 */
import { query, mutation } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function requireUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new ConvexError({ message: "Usuario no autenticado", code: "UNAUTHENTICATED" });
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

function generateReportCode(modality: string): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${modality.slice(0, 2).toUpperCase()}-${date}-${rand}`;
}

// ─── Worklist Queries ─────────────────────────────────────────────────────────

export const listStudies = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("reported"),
      v.literal("archived"),
      v.literal("all")
    )),
  },
  handler: async (ctx, args): Promise<{
    page: {
      _id: string;
      userId: string;
      studyInstanceUid: string;
      patientName: string;
      patientId: string;
      studyDate: string;
      modality: string;
      studyDescription: string;
      institution: string;
      accessionNumber: string;
      seriesCount: number;
      imageCount: number;
      referringPhysician: string | undefined;
      status: "pending" | "in_progress" | "reported" | "archived";
      assignedDoctor: string | undefined;
      receivedAt: string;
      updatedAt: string;
      studyTime: string | undefined;
      sourceLabel: string | undefined;
      sourceType: string | undefined;
      notes: string | undefined;
      _creationTime: number;
    }[];
    isDone: boolean;
    continueCursor: string;
  }> => {
    const user = await requireUser(ctx);
    const statusFilter = args.status && args.status !== "all" ? args.status : null;

    let q;
    if (statusFilter) {
      q = ctx.db
        .query("worklistStudies")
        .withIndex("by_user_and_status", (qi) => qi.eq("userId", user._id).eq("status", statusFilter))
        .order("desc");
    } else {
      q = ctx.db
        .query("worklistStudies")
        .withIndex("by_user", (qi) => qi.eq("userId", user._id))
        .order("desc");
    }

    const result = await q.paginate(args.paginationOpts);
    return {
      ...result,
      page: result.page.map((s) => ({
        _id: s._id,
        userId: s.userId,
        studyInstanceUid: s.studyInstanceUid,
        patientName: s.patientName,
        patientId: s.patientId,
        studyDate: s.studyDate,
        modality: s.modality,
        studyDescription: s.studyDescription,
        institution: s.institution,
        accessionNumber: s.accessionNumber,
        seriesCount: s.seriesCount,
        imageCount: s.imageCount,
        referringPhysician: s.referringPhysician,
        status: s.status,
        assignedDoctor: s.assignedDoctor,
        receivedAt: s.receivedAt,
        updatedAt: s.updatedAt,
        studyTime: s.studyTime,
        sourceLabel: s.sourceLabel,
        sourceType: s.sourceType,
        notes: s.notes,
        _creationTime: s._creationTime,
      })),
    };
  },
});

export const getStudy = query({
  args: { studyId: v.id("worklistStudies") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const study = await ctx.db.get(args.studyId);
    if (!study || study.userId !== user._id) return null;
    return study;
  },
});

export const getStudyByUid = query({
  args: { studyInstanceUid: v.string() },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const study = await ctx.db
      .query("worklistStudies")
      .withIndex("by_uid", (q) => q.eq("studyInstanceUid", args.studyInstanceUid))
      .first();
    if (!study || study.userId !== user._id) return null;
    return study;
  },
});

export const getStats = query({
  args: {},
  handler: async (ctx): Promise<{ pending: number; in_progress: number; reported: number; archived: number; total: number }> => {
    const user = await requireUser(ctx);

    const pending = await ctx.db
      .query("worklistStudies")
      .withIndex("by_user_and_status", (q) => q.eq("userId", user._id).eq("status", "pending"))
      .collect();
    const in_progress = await ctx.db
      .query("worklistStudies")
      .withIndex("by_user_and_status", (q) => q.eq("userId", user._id).eq("status", "in_progress"))
      .collect();
    const reported = await ctx.db
      .query("worklistStudies")
      .withIndex("by_user_and_status", (q) => q.eq("userId", user._id).eq("status", "reported"))
      .collect();
    const archived = await ctx.db
      .query("worklistStudies")
      .withIndex("by_user_and_status", (q) => q.eq("userId", user._id).eq("status", "archived"))
      .collect();

    return {
      pending: pending.length,
      in_progress: in_progress.length,
      reported: reported.length,
      archived: archived.length,
      total: pending.length + in_progress.length + reported.length + archived.length,
    };
  },
});

// ─── Worklist Mutations ───────────────────────────────────────────────────────

export const upsertStudy = mutation({
  args: {
    studyInstanceUid: v.string(),
    patientName: v.string(),
    patientId: v.string(),
    studyDate: v.string(),
    studyTime: v.optional(v.string()),
    modality: v.string(),
    studyDescription: v.string(),
    institution: v.string(),
    accessionNumber: v.string(),
    seriesCount: v.number(),
    imageCount: v.number(),
    referringPhysician: v.optional(v.string()),
    sourceLabel: v.optional(v.string()),
    sourceType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const now = new Date().toISOString();

    // Verificar duplicado
    const existing = await ctx.db
      .query("worklistStudies")
      .withIndex("by_uid", (q) => q.eq("studyInstanceUid", args.studyInstanceUid))
      .first();

    if (existing) {
      // Actualizar conteos si el estudio ya existe (pueden haberse añadido series)
      if (existing.userId !== user._id) {
        throw new ConvexError({ message: "Estudio pertenece a otro usuario", code: "FORBIDDEN" });
      }
      await ctx.db.patch(existing._id, {
        seriesCount: Math.max(existing.seriesCount, args.seriesCount),
        imageCount: Math.max(existing.imageCount, args.imageCount),
        updatedAt: now,
      });
      return { id: existing._id, isDuplicate: true };
    }

    const id = await ctx.db.insert("worklistStudies", {
      userId: user._id,
      studyInstanceUid: args.studyInstanceUid,
      patientName: args.patientName,
      patientId: args.patientId,
      studyDate: args.studyDate,
      studyTime: args.studyTime,
      modality: args.modality,
      studyDescription: args.studyDescription,
      institution: args.institution,
      accessionNumber: args.accessionNumber,
      seriesCount: args.seriesCount,
      imageCount: args.imageCount,
      referringPhysician: args.referringPhysician,
      status: "pending",
      receivedAt: now,
      updatedAt: now,
      sourceLabel: args.sourceLabel,
      sourceType: args.sourceType,
    });

    return { id, isDuplicate: false };
  },
});

export const updateStatus = mutation({
  args: {
    studyId: v.id("worklistStudies"),
    status: v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("reported"),
      v.literal("archived")
    ),
    assignedDoctor: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const study = await ctx.db.get(args.studyId);
    if (!study || study.userId !== user._id) {
      throw new ConvexError({ message: "Estudio no encontrado", code: "NOT_FOUND" });
    }
    await ctx.db.patch(args.studyId, {
      status: args.status,
      updatedAt: new Date().toISOString(),
      ...(args.assignedDoctor !== undefined ? { assignedDoctor: args.assignedDoctor } : {}),
    });
  },
});

export const deleteStudy = mutation({
  args: { studyId: v.id("worklistStudies") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const study = await ctx.db.get(args.studyId);
    if (!study || study.userId !== user._id) {
      throw new ConvexError({ message: "Estudio no encontrado", code: "NOT_FOUND" });
    }
    await ctx.db.delete(args.studyId);
  },
});

// ─── Manual Reports ───────────────────────────────────────────────────────────

export const getReportByStudy = query({
  args: { studyId: v.id("worklistStudies") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const report = await ctx.db
      .query("manualReports")
      .withIndex("by_study", (q) => q.eq("studyId", args.studyId))
      .first();
    if (!report || report.userId !== user._id) return null;
    return report;
  },
});

export const listReports = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(v.union(v.literal("draft"), v.literal("final"))),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const result = await ctx.db
      .query("manualReports")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .paginate(args.paginationOpts);
    if (args.status) {
      return { ...result, page: result.page.filter((r) => r.status === args.status) };
    }
    return result;
  },
});

export const deleteManualReport = mutation({
  args: { reportId: v.id("manualReports") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const report = await ctx.db.get(args.reportId);
    if (!report || report.userId !== user._id) {
      throw new ConvexError({ message: "Informe no encontrado", code: "NOT_FOUND" });
    }
    await ctx.db.delete(args.reportId);
  },
});

export const saveReport = mutation({
  args: {
    studyId: v.id("worklistStudies"),
    indication: v.string(),
    technique: v.string(),
    findings: v.string(),
    conclusion: v.string(),
    recommendations: v.string(),
    status: v.union(v.literal("draft"), v.literal("final")),
    doctorName: v.optional(v.string()),
    doctorRegistration: v.optional(v.string()),
    doctorSpecialty: v.optional(v.string()),
    templateName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const study = await ctx.db.get(args.studyId);
    if (!study || study.userId !== user._id) {
      throw new ConvexError({ message: "Estudio no encontrado", code: "NOT_FOUND" });
    }

    const now = new Date().toISOString();

    // Check if report already exists
    const existing = await ctx.db
      .query("manualReports")
      .withIndex("by_study", (q) => q.eq("studyId", args.studyId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        indication: args.indication,
        technique: args.technique,
        findings: args.findings,
        conclusion: args.conclusion,
        recommendations: args.recommendations,
        status: args.status,
        doctorName: args.doctorName,
        doctorRegistration: args.doctorRegistration,
        doctorSpecialty: args.doctorSpecialty,
        templateName: args.templateName,
        updatedAt: now,
        ...(args.status === "final" ? { finalizedAt: now } : {}),
      });

      // Update study status
      await ctx.db.patch(args.studyId, {
        status: args.status === "final" ? "reported" : "in_progress",
        updatedAt: now,
        assignedDoctor: args.doctorName,
      });

      return existing._id;
    }

    const reportCode = generateReportCode(study.modality);
    const id = await ctx.db.insert("manualReports", {
      userId: user._id,
      studyId: args.studyId,
      studyInstanceUid: study.studyInstanceUid,
      patientName: study.patientName,
      patientId: study.patientId,
      modality: study.modality,
      studyDate: study.studyDate,
      studyDescription: study.studyDescription,
      reportCode,
      indication: args.indication,
      technique: args.technique,
      findings: args.findings,
      conclusion: args.conclusion,
      recommendations: args.recommendations,
      status: args.status,
      doctorName: args.doctorName,
      doctorRegistration: args.doctorRegistration,
      doctorSpecialty: args.doctorSpecialty,
      templateName: args.templateName,
      createdAt: now,
      updatedAt: now,
      ...(args.status === "final" ? { finalizedAt: now } : {}),
    });

    // Update study status
    await ctx.db.patch(args.studyId, {
      status: args.status === "final" ? "reported" : "in_progress",
      updatedAt: now,
      assignedDoctor: args.doctorName,
    });

    return id;
  },
});

// ─── Manual Report Templates ──────────────────────────────────────────────────

export const listTemplates = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return await ctx.db
      .query("manualReportTemplates")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
  },
});

export const saveTemplate = mutation({
  args: {
    templateId: v.optional(v.id("manualReportTemplates")),
    name: v.string(),
    modality: v.optional(v.string()),
    indication: v.optional(v.string()),
    technique: v.optional(v.string()),
    findings: v.optional(v.string()),
    conclusion: v.optional(v.string()),
    recommendations: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const now = new Date().toISOString();
    if (args.templateId) {
      const t = await ctx.db.get(args.templateId);
      if (!t || t.userId !== user._id) {
        throw new ConvexError({ message: "Plantilla no encontrada", code: "NOT_FOUND" });
      }
      await ctx.db.patch(args.templateId, {
        name: args.name,
        modality: args.modality,
        indication: args.indication,
        technique: args.technique,
        findings: args.findings,
        conclusion: args.conclusion,
        recommendations: args.recommendations,
        updatedAt: now,
      });
      return args.templateId;
    }
    return await ctx.db.insert("manualReportTemplates", {
      userId: user._id,
      name: args.name,
      modality: args.modality,
      indication: args.indication,
      technique: args.technique,
      findings: args.findings,
      conclusion: args.conclusion,
      recommendations: args.recommendations,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const deleteTemplate = mutation({
  args: { templateId: v.id("manualReportTemplates") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const t = await ctx.db.get(args.templateId);
    if (!t || t.userId !== user._id) {
      throw new ConvexError({ message: "Plantilla no encontrada", code: "NOT_FOUND" });
    }
    await ctx.db.delete(args.templateId);
  },
});

// ─── Worklist Config (Fuente de estudios) ────────────────────────────────────

export const getWorklistConfig = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const config = await ctx.db
      .query("worklistConfig")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    return config ?? null;
  },
});

export const saveWorklistConfig = mutation({
  args: {
    activeSource: v.string(),
    localFolderPath: v.optional(v.string()),
    lastScannedAt: v.optional(v.string()),
    lastScanCount: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const now = new Date().toISOString();
    const existing = await ctx.db
      .query("worklistConfig")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, {
        activeSource: args.activeSource,
        localFolderPath: args.localFolderPath,
        ...(args.lastScannedAt !== undefined ? { lastScannedAt: args.lastScannedAt } : {}),
        ...(args.lastScanCount !== undefined ? { lastScanCount: args.lastScanCount } : {}),
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("worklistConfig", {
      userId: user._id,
      activeSource: args.activeSource,
      localFolderPath: args.localFolderPath,
      lastScannedAt: args.lastScannedAt,
      lastScanCount: args.lastScanCount,
      updatedAt: now,
    });
  },
});

// ─── Empresa: Company-scoped Worklist ─────────────────────────────────────────

async function requireCompanyUser(ctx: QueryCtx | MutationCtx) {
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

/** Lista estudios de toda la empresa (paginado) — para company_admin */
export const listByCompany = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("reported"),
      v.literal("archived"),
      v.literal("all"),
    )),
    assignedDoctorId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{
    page: {
      _id: string;
      userId: string;
      studyInstanceUid: string;
      patientName: string;
      patientId: string;
      studyDate: string;
      modality: string;
      studyDescription: string;
      institution: string;
      accessionNumber: string;
      seriesCount: number;
      imageCount: number;
      referringPhysician: string | undefined;
      status: "pending" | "in_progress" | "reported" | "archived";
      assignedDoctor: string | undefined;
      assignedDoctorId: string | undefined;
      receivedAt: string;
      updatedAt: string;
      studyTime: string | undefined;
      sourceLabel: string | undefined;
      sourceType: string | undefined;
      notes: string | undefined;
      _creationTime: number;
    }[];
    isDone: boolean;
    continueCursor: string;
  }> => {
    const user = await requireCompanyUser(ctx);
    const companyId = user.companyId!;
    const statusFilter = args.status && args.status !== "all" ? args.status : null;

    const q = ctx.db
      .query("worklistStudies")
      .withIndex("by_company", (qi) => qi.eq("companyId", companyId))
      .order("desc");

    const result = await q.paginate(args.paginationOpts);

    let page = result.page;
    if (statusFilter) {
      page = page.filter((s) => s.status === statusFilter);
    }
    if (args.assignedDoctorId) {
      page = page.filter((s) => s.assignedDoctor === args.assignedDoctorId);
    }

    return {
      ...result,
      page: page.map((s) => ({
        _id: s._id,
        userId: s.userId,
        studyInstanceUid: s.studyInstanceUid,
        patientName: s.patientName,
        patientId: s.patientId,
        studyDate: s.studyDate,
        modality: s.modality,
        studyDescription: s.studyDescription,
        institution: s.institution,
        accessionNumber: s.accessionNumber,
        seriesCount: s.seriesCount,
        imageCount: s.imageCount,
        referringPhysician: s.referringPhysician,
        status: s.status,
        assignedDoctor: s.assignedDoctor,
        assignedDoctorId: s.assignedDoctor,
        receivedAt: s.receivedAt,
        updatedAt: s.updatedAt,
        studyTime: s.studyTime,
        sourceLabel: s.sourceLabel,
        sourceType: s.sourceType,
        notes: s.notes,
        _creationTime: s._creationTime,
      })),
    };
  },
});

/** Estudios del médico autenticado (medical_user ve solo los suyos) */
export const listMyStudies = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(v.union(
      v.literal("pending"),
      v.literal("in_progress"),
      v.literal("reported"),
      v.literal("archived"),
      v.literal("all"),
    )),
  },
  handler: async (ctx, args): Promise<{
    page: {
      _id: string;
      userId: string;
      studyInstanceUid: string;
      patientName: string;
      patientId: string;
      studyDate: string;
      modality: string;
      studyDescription: string;
      institution: string;
      accessionNumber: string;
      seriesCount: number;
      imageCount: number;
      referringPhysician: string | undefined;
      status: "pending" | "in_progress" | "reported" | "archived";
      assignedDoctor: string | undefined;
      receivedAt: string;
      updatedAt: string;
      studyTime: string | undefined;
      sourceLabel: string | undefined;
      sourceType: string | undefined;
      notes: string | undefined;
      _creationTime: number;
    }[];
    isDone: boolean;
    continueCursor: string;
  }> => {
    const user = await requireCompanyUser(ctx);
    const doctorName = [user.name, user.lastName].filter(Boolean).join(" ");
    const statusFilter = args.status && args.status !== "all" ? args.status : null;

    const q = ctx.db
      .query("worklistStudies")
      .withIndex("by_company", (qi) => qi.eq("companyId", user.companyId!))
      .order("desc");

    const result = await q.paginate(args.paginationOpts);

    // Medical users only see studies assigned to them
    let page = result.page.filter((s) =>
      s.assignedDoctor === doctorName || s.userId === user._id
    );
    if (statusFilter) {
      page = page.filter((s) => s.status === statusFilter);
    }

    return {
      ...result,
      page: page.map((s) => ({
        _id: s._id,
        userId: s.userId,
        studyInstanceUid: s.studyInstanceUid,
        patientName: s.patientName,
        patientId: s.patientId,
        studyDate: s.studyDate,
        modality: s.modality,
        studyDescription: s.studyDescription,
        institution: s.institution,
        accessionNumber: s.accessionNumber,
        seriesCount: s.seriesCount,
        imageCount: s.imageCount,
        referringPhysician: s.referringPhysician,
        status: s.status,
        assignedDoctor: s.assignedDoctor,
        receivedAt: s.receivedAt,
        updatedAt: s.updatedAt,
        studyTime: s.studyTime,
        sourceLabel: s.sourceLabel,
        sourceType: s.sourceType,
        notes: s.notes,
        _creationTime: s._creationTime,
      })),
    };
  },
});

/** Stats de estudios para la empresa */
export const getCompanyStats = query({
  args: {},
  handler: async (ctx): Promise<{
    pending: number;
    in_progress: number;
    reported: number;
    archived: number;
    total: number;
    today: number;
    thisMonth: number;
  }> => {
    const user = await requireCompanyUser(ctx);
    const all = await ctx.db
      .query("worklistStudies")
      .withIndex("by_company", (q) => q.eq("companyId", user.companyId!))
      .collect();

    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const monthStr = now.toISOString().slice(0, 7);

    return {
      pending: all.filter((s) => s.status === "pending").length,
      in_progress: all.filter((s) => s.status === "in_progress").length,
      reported: all.filter((s) => s.status === "reported").length,
      archived: all.filter((s) => s.status === "archived").length,
      total: all.length,
      today: all.filter((s) => s.receivedAt.startsWith(todayStr)).length,
      thisMonth: all.filter((s) => s.receivedAt.startsWith(monthStr)).length,
    };
  },
});

/** Asignar médico a un estudio (company_admin) */
export const assignDoctor = mutation({
  args: {
    studyId: v.id("worklistStudies"),
    doctorName: v.string(),
    doctorUserId: v.optional(v.id("users")),
  },
  handler: async (ctx, args): Promise<void> => {
    const user = await requireCompanyUser(ctx);
    const study = await ctx.db.get(args.studyId);
    if (!study || study.companyId !== user.companyId) {
      throw new ConvexError({ message: "Estudio no encontrado", code: "NOT_FOUND" });
    }
    await ctx.db.patch(args.studyId, {
      assignedDoctor: args.doctorName,
      status: study.status === "pending" ? "in_progress" : study.status,
      updatedAt: new Date().toISOString(),
    });
  },
});

/** Upsert company-scoped study */
export const upsertCompanyStudy = mutation({
  args: {
    studyInstanceUid: v.string(),
    patientName: v.string(),
    patientId: v.string(),
    studyDate: v.string(),
    studyTime: v.optional(v.string()),
    modality: v.string(),
    studyDescription: v.string(),
    institution: v.string(),
    accessionNumber: v.string(),
    seriesCount: v.number(),
    imageCount: v.number(),
    referringPhysician: v.optional(v.string()),
    sourceLabel: v.optional(v.string()),
    sourceType: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ id: string; isDuplicate: boolean }> => {
    const user = await requireCompanyUser(ctx);
    const now = new Date().toISOString();

    const existing = await ctx.db
      .query("worklistStudies")
      .withIndex("by_uid", (q) => q.eq("studyInstanceUid", args.studyInstanceUid))
      .first();

    if (existing) {
      if (existing.companyId !== user.companyId) {
        throw new ConvexError({ message: "UID duplicado en otra empresa", code: "CONFLICT" });
      }
      await ctx.db.patch(existing._id, {
        seriesCount: Math.max(existing.seriesCount, args.seriesCount),
        imageCount: Math.max(existing.imageCount, args.imageCount),
        updatedAt: now,
      });
      return { id: existing._id, isDuplicate: true };
    }

    const id = await ctx.db.insert("worklistStudies", {
      userId: user._id,
      companyId: user.companyId,
      studyInstanceUid: args.studyInstanceUid,
      patientName: args.patientName,
      patientId: args.patientId,
      studyDate: args.studyDate,
      studyTime: args.studyTime,
      modality: args.modality,
      studyDescription: args.studyDescription,
      institution: args.institution,
      accessionNumber: args.accessionNumber,
      seriesCount: args.seriesCount,
      imageCount: args.imageCount,
      referringPhysician: args.referringPhysician,
      status: "pending",
      receivedAt: now,
      updatedAt: now,
      sourceLabel: args.sourceLabel,
      sourceType: args.sourceType,
    });

    return { id, isDuplicate: false };
  },
});
