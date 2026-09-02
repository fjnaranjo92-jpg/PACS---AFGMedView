/**
 * Companies module — multitenancy for AFG MedView.
 * Manages companies, invitations, and user-company membership.
 */
import { v, ConvexError } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel.d.ts";

// ─── Helper: get current user (throws if not authed) ──────────────────────────

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

async function requireCompanyAdmin(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "company_admin") {
    throw new ConvexError({ message: "Acceso denegado — se requiere rol de administrador de empresa", code: "FORBIDDEN" });
  }
  return user;
}

// ─── Super Admin: Company CRUD ─────────────────────────────────────────────────

/** List all companies (Super Admin only — verified on client via admin session) */
export const listAll = query({
  args: {
    status: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Doc<"companies">[]> => {
    if (args.status) {
      return ctx.db
        .query("companies")
        .withIndex("by_status", (q) =>
          q.eq("status", args.status as "active" | "inactive" | "suspended" | "trial")
        )
        .collect();
    }
    return ctx.db.query("companies").collect();
  },
});

/** Get a single company by ID */
export const getById = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args): Promise<Doc<"companies"> | null> => {
    return ctx.db.get(args.companyId);
  },
});

/** Create a new company and generate an invitation for its admin */
export const create = mutation({
  args: {
    name: v.string(),
    adminEmail: v.string(),
    adminName: v.optional(v.string()),
    planName: v.string(),
    maxUsers: v.number(),
    status: v.union(
      v.literal("active"),
      v.literal("inactive"),
      v.literal("suspended"),
      v.literal("trial"),
    ),
    expiresAt: v.optional(v.string()),
    notes: v.optional(v.string()),
    country: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Id<"companies">> => {
    const now = new Date().toISOString();
    const companyId = await ctx.db.insert("companies", {
      name: args.name,
      adminEmail: args.adminEmail.toLowerCase().trim(),
      planName: args.planName,
      maxUsers: args.maxUsers,
      status: args.status,
      expiresAt: args.expiresAt,
      notes: args.notes,
      country: args.country,
      phone: args.phone,
      createdAt: now,
      updatedAt: now,
    });

    // Create invitation for the company admin
    await ctx.db.insert("companyInvitations", {
      companyId,
      email: args.adminEmail.toLowerCase().trim(),
      inviteeName: args.adminName,
      role: "company_admin",
      status: "pending",
      createdBy: "super_admin",
      createdAt: now,
    });

    return companyId;
  },
});

/** Update company details */
export const update = mutation({
  args: {
    companyId: v.id("companies"),
    name: v.optional(v.string()),
    adminEmail: v.optional(v.string()),
    planName: v.optional(v.string()),
    maxUsers: v.optional(v.number()),
    status: v.optional(v.union(
      v.literal("active"),
      v.literal("inactive"),
      v.literal("suspended"),
      v.literal("trial"),
    )),
    expiresAt: v.optional(v.string()),
    notes: v.optional(v.string()),
    country: v.optional(v.string()),
    phone: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const { companyId, ...updates } = args;
    await ctx.db.patch(companyId, {
      ...updates,
      updatedAt: new Date().toISOString(),
    });
  },
});

/** Toggle company status active/inactive */
export const toggleStatus = mutation({
  args: { companyId: v.id("companies"), status: v.union(v.literal("active"), v.literal("inactive")) },
  handler: async (ctx, args): Promise<void> => {
    await ctx.db.patch(args.companyId, {
      status: args.status,
      updatedAt: new Date().toISOString(),
    });
  },
});

/** Get stats for a company (user count, etc.) */
export const getStats = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args): Promise<{
    totalUsers: number;
    activeUsers: number;
    pendingInvitations: number;
  }> => {
    const users = await ctx.db
      .query("users")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .collect();
    const totalUsers = users.filter((u) => u.companyStatus !== "pending").length;
    const activeUsers = users.filter((u) => u.companyStatus === "active").length;

    const invitations = await ctx.db
      .query("companyInvitations")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();

    return { totalUsers, activeUsers, pendingInvitations: invitations.length };
  },
});

// ─── Invitations ───────────────────────────────────────────────────────────────

/** List invitations for a company */
export const listInvitations = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args): Promise<Doc<"companyInvitations">[]> => {
    return ctx.db
      .query("companyInvitations")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .collect();
  },
});

/** Create an invitation (company admin invites a user) */
export const createInvitation = mutation({
  args: {
    companyId: v.id("companies"),
    email: v.string(),
    inviteeName: v.optional(v.string()),
    inviteeLastName: v.optional(v.string()),
    role: v.union(
      v.literal("company_admin"),
      v.literal("medical_user"),
      v.literal("tecnico"),
      v.literal("recepcion"),
      v.literal("consulta"),
    ),
    professionalCode: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const user = await requireUser(ctx);
    if (user.role !== "company_admin" || user.companyId !== args.companyId) {
      throw new ConvexError({ message: "Solo el administrador de la empresa puede invitar usuarios", code: "FORBIDDEN" });
    }

    // Check user limit
    const company = await ctx.db.get(args.companyId);
    if (!company) throw new ConvexError({ message: "Empresa no encontrada", code: "NOT_FOUND" });

    const companyUsers = await ctx.db
      .query("users")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .filter((q) => q.neq(q.field("companyStatus"), "pending"))
      .collect();
    const pendingInvitations = await ctx.db
      .query("companyInvitations")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();

    const totalCount = companyUsers.length + pendingInvitations.length;
    if (totalCount >= company.maxUsers) {
      throw new ConvexError({
        message: `Has alcanzado el límite de usuarios de tu plan (${company.maxUsers} usuarios máximo).`,
        code: "CONFLICT",
      });
    }

    // Check if already invited
    const existing = await ctx.db
      .query("companyInvitations")
      .withIndex("by_email_and_status", (q) =>
        q.eq("email", args.email.toLowerCase().trim()).eq("status", "pending")
      )
      .first();
    if (existing && existing.companyId === args.companyId) {
      throw new ConvexError({ message: "Este usuario ya tiene una invitación pendiente", code: "CONFLICT" });
    }

    const identity = await ctx.auth.getUserIdentity();
    await ctx.db.insert("companyInvitations", {
      companyId: args.companyId,
      email: args.email.toLowerCase().trim(),
      inviteeName: args.inviteeName,
      inviteeLastName: args.inviteeLastName,
      role: args.role,
      professionalCode: args.professionalCode,
      status: "pending",
      createdBy: identity?.tokenIdentifier ?? "admin",
      createdAt: new Date().toISOString(),
    });
  },
});

/** Cancel an invitation */
export const cancelInvitation = mutation({
  args: { invitationId: v.id("companyInvitations") },
  handler: async (ctx, args): Promise<void> => {
    const user = await requireUser(ctx);
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) throw new ConvexError({ message: "Invitación no encontrada", code: "NOT_FOUND" });
    if (user.role !== "company_admin" || user.companyId !== invitation.companyId) {
      throw new ConvexError({ message: "No tiene permisos para cancelar esta invitación", code: "FORBIDDEN" });
    }
    await ctx.db.patch(args.invitationId, { status: "cancelled" });
  },
});

/**
 * Internal: Apply pending invitations for a user who just logged in.
 * Called from updateCurrentUser after the user record is created/updated.
 */
export const applyPendingInvitationInternal = internalMutation({
  args: { email: v.string(), userId: v.id("users") },
  handler: async (ctx, args): Promise<void> => {
    const email = args.email.toLowerCase().trim();
    const invitation = await ctx.db
      .query("companyInvitations")
      .withIndex("by_email_and_status", (q) => q.eq("email", email).eq("status", "pending"))
      .first();

    if (!invitation) return;

    await ctx.db.patch(args.userId, {
      companyId: invitation.companyId,
      role: invitation.role,
      companyStatus: "active",
      professionalCode: invitation.professionalCode,
    });

    await ctx.db.patch(invitation._id, {
      status: "accepted",
      acceptedAt: new Date().toISOString(),
    });
  },
});

/**
 * Apply pending invitations for a user who just logged in.
 * Called from updateCurrentUser after the user record is created/updated.
 */
export const applyPendingInvitation = mutation({
  args: { email: v.string(), userId: v.id("users") },
  handler: async (ctx, args): Promise<void> => {
    const email = args.email.toLowerCase().trim();
    // Find a pending invitation for this email
    const invitation = await ctx.db
      .query("companyInvitations")
      .withIndex("by_email_and_status", (q) => q.eq("email", email).eq("status", "pending"))
      .first();

    if (!invitation) return;

    // Assign the user to the company
    await ctx.db.patch(args.userId, {
      companyId: invitation.companyId,
      role: invitation.role,
      companyStatus: "active",
      professionalCode: invitation.professionalCode,
    });

    // Mark invitation as accepted
    await ctx.db.patch(invitation._id, {
      status: "accepted",
      acceptedAt: new Date().toISOString(),
    });
  },
});

// ─── Company users management (by company admin) ───────────────────────────────

/** Get users in the current admin's company */
export const getMyCompanyUsers = query({
  args: {},
  handler: async (ctx): Promise<Doc<"users">[]> => {
    const user = await requireUser(ctx);
    if (!user.companyId) return [];
    return ctx.db
      .query("users")
      .withIndex("by_company", (q) => q.eq("companyId", user.companyId))
      .collect();
  },
});

/** Get current user's company */
export const getMyCompany = query({
  args: {},
  handler: async (ctx): Promise<Doc<"companies"> | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user?.companyId) return null;
    return ctx.db.get(user.companyId);
  },
});

/** Update a company user's role or status (company admin only) */
export const updateCompanyUser = mutation({
  args: {
    targetUserId: v.id("users"),
    role: v.optional(v.union(
      v.literal("company_admin"),
      v.literal("medical_user"),
      v.literal("tecnico"),
      v.literal("recepcion"),
      v.literal("consulta"),
    )),
    companyStatus: v.optional(v.union(v.literal("active"), v.literal("inactive"))),
    professionalCode: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const admin = await requireCompanyAdmin(ctx);
    const targetUser = await ctx.db.get(args.targetUserId);
    if (!targetUser) throw new ConvexError({ message: "Usuario no encontrado", code: "NOT_FOUND" });
    if (targetUser.companyId !== admin.companyId) {
      throw new ConvexError({ message: "No puede modificar usuarios de otra empresa", code: "FORBIDDEN" });
    }
    // Prevent removing the only admin
    if (args.role && args.role !== "company_admin" && targetUser.role === "company_admin") {
      const admins = await ctx.db
        .query("users")
        .withIndex("by_company", (q) => q.eq("companyId", admin.companyId))
        .filter((q) => q.eq(q.field("role"), "company_admin"))
        .collect();
      if (admins.length <= 1) {
        throw new ConvexError({ message: "No puede cambiar el rol: la empresa necesita al menos un administrador", code: "CONFLICT" });
      }
    }
    await ctx.db.patch(args.targetUserId, {
      ...(args.role !== undefined && { role: args.role }),
      ...(args.companyStatus !== undefined && { companyStatus: args.companyStatus }),
      ...(args.professionalCode !== undefined && { professionalCode: args.professionalCode }),
    });
  },
});

/** Remove a user from the company (company admin only) */
export const removeCompanyUser = mutation({
  args: { targetUserId: v.id("users") },
  handler: async (ctx, args): Promise<void> => {
    const admin = await requireCompanyAdmin(ctx);
    const targetUser = await ctx.db.get(args.targetUserId);
    if (!targetUser) throw new ConvexError({ message: "Usuario no encontrado", code: "NOT_FOUND" });
    if (targetUser.companyId !== admin.companyId) {
      throw new ConvexError({ message: "No puede eliminar usuarios de otra empresa", code: "FORBIDDEN" });
    }
    if (targetUser._id === admin._id) {
      throw new ConvexError({ message: "No puede eliminarse a sí mismo", code: "CONFLICT" });
    }
    await ctx.db.patch(args.targetUserId, {
      companyId: undefined,
      role: undefined,
      companyStatus: undefined,
    });
  },
});

/** Get company dashboard stats */
export const getMyCompanyStats = query({
  args: {},
  handler: async (ctx): Promise<{
    company: Doc<"companies"> | null;
    totalUsers: number;
    activeUsers: number;
    maxUsers: number;
    pendingInvitations: number;
  }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { company: null, totalUsers: 0, activeUsers: 0, maxUsers: 0, pendingInvitations: 0 };

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user?.companyId) return { company: null, totalUsers: 0, activeUsers: 0, maxUsers: 0, pendingInvitations: 0 };

    const company = await ctx.db.get(user.companyId);
    if (!company) return { company: null, totalUsers: 0, activeUsers: 0, maxUsers: 0, pendingInvitations: 0 };

    const companyId = user.companyId;
    const allUsers = await ctx.db
      .query("users")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .collect();
    const totalUsers = allUsers.filter((u) => u.companyStatus !== "pending").length;
    const activeUsers = allUsers.filter((u) => u.companyStatus === "active").length;

    const pendingInvitations = await ctx.db
      .query("companyInvitations")
      .withIndex("by_company", (q) => q.eq("companyId", companyId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();

    return {
      company,
      totalUsers,
      activeUsers,
      maxUsers: company.maxUsers,
      pendingInvitations: pendingInvitations.length,
    };
  },
});

/** List users for a company — admin view */
export const listCompanyUsers = query({
  args: { companyId: v.id("companies") },
  handler: async (ctx, args): Promise<Doc<"users">[]> => {
    return ctx.db
      .query("users")
      .withIndex("by_company", (q) => q.eq("companyId", args.companyId))
      .collect();
  },
});

// ─── Company Data Update (company admin self-service) ─────────────────────────

/** Update company data fields (company admin only, own company) */
export const updateCompanyData = mutation({
  args: {
    name: v.optional(v.string()),
    razonSocial: v.optional(v.string()),
    ruc: v.optional(v.string()),
    direccion: v.optional(v.string()),
    ciudad: v.optional(v.string()),
    country: v.optional(v.string()),
    phone: v.optional(v.string()),
    website: v.optional(v.string()),
    description: v.optional(v.string()),
    logoUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<void> => {
    const admin = await requireCompanyAdmin(ctx);
    if (!admin.companyId) {
      throw new ConvexError({ message: "No pertenece a ninguna empresa", code: "FORBIDDEN" });
    }
    const company = await ctx.db.get(admin.companyId);
    if (!company) {
      throw new ConvexError({ message: "Empresa no encontrada", code: "NOT_FOUND" });
    }

    // Build patch object with only provided fields
    const patch: Record<string, string | undefined> = {};
    if (args.name !== undefined) patch.name = args.name;
    if (args.razonSocial !== undefined) patch.razonSocial = args.razonSocial;
    if (args.ruc !== undefined) patch.ruc = args.ruc;
    if (args.direccion !== undefined) patch.direccion = args.direccion;
    if (args.ciudad !== undefined) patch.ciudad = args.ciudad;
    if (args.country !== undefined) patch.country = args.country;
    if (args.phone !== undefined) patch.phone = args.phone;
    if (args.website !== undefined) patch.website = args.website;
    if (args.description !== undefined) patch.description = args.description;
    if (args.logoUrl !== undefined) patch.logoUrl = args.logoUrl;

    await ctx.db.patch(admin.companyId, {
      ...patch,
      updatedAt: new Date().toISOString(),
    });
  },
});
