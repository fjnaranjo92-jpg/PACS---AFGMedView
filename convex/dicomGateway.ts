/**
 * DICOM Gateway — Convex backend
 *
 * Mutations/Queries called by the HTTP actions (from the external DICOM gateway)
 * and by the Admin UI.
 */
import { mutation, query, internalMutation } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel.d.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

// ─── Heartbeat (gateway → Convex) ────────────────────────────────────────────

export const heartbeat = mutation({
  args: {
    aeTitle: v.string(),
    port: v.number(),
    serverIp: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("dicomGatewayStatus")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();

    const ts = now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        aeTitle: args.aeTitle,
        port: args.port,
        serverIp: args.serverIp,
        isOnline: true,
        lastHeartbeatAt: ts,
        updatedAt: ts,
      });
    } else {
      await ctx.db.insert("dicomGatewayStatus", {
        key: "singleton",
        aeTitle: args.aeTitle,
        port: args.port,
        serverIp: args.serverIp,
        isOnline: true,
        lastHeartbeatAt: ts,
        totalStudiesReceived: 0,
        totalInstancesReceived: 0,
        totalErrors: 0,
        updatedAt: ts,
      });
    }
  },
});

// ─── Log C-ECHO (gateway → Convex) ──────────────────────────────────────────

export const logEcho = mutation({
  args: {
    sourceAeTitle: v.optional(v.string()),
    sourceIp: v.optional(v.string()),
    success: v.boolean(),
  },
  handler: async (ctx, args) => {
    const ts = now();
    // Log entry
    await ctx.db.insert("dicomGatewayLogs", {
      level: args.success ? "info" : "error",
      event: args.success ? "c_echo_success" : "c_echo_failed",
      message: args.success
        ? `C-ECHO SUCCESS from ${args.sourceAeTitle ?? "unknown"} (${args.sourceIp ?? "?"})`
        : `C-ECHO FAILED from ${args.sourceAeTitle ?? "unknown"}`,
      sourceAeTitle: args.sourceAeTitle,
      sourceIp: args.sourceIp,
      occurredAt: ts,
    });

    // Update singleton
    const existing = await ctx.db
      .query("dicomGatewayStatus")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    if (existing && args.success) {
      await ctx.db.patch(existing._id, {
        lastEchoAt: ts,
        lastEchoSourceAe: args.sourceAeTitle,
        updatedAt: ts,
      });
    }
  },
});

// ─── Receive DICOM instance (gateway → Convex) ───────────────────────────────

export const receiveInstance = mutation({
  args: {
    // Study-level
    studyInstanceUid: v.string(),
    patientName: v.string(),
    patientId: v.string(),
    patientBirthDate: v.optional(v.string()),
    patientSex: v.optional(v.string()),
    studyDate: v.optional(v.string()),
    studyTime: v.optional(v.string()),
    studyDescription: v.optional(v.string()),
    accessionNumber: v.optional(v.string()),
    modality: v.string(),
    // Series-level
    seriesInstanceUid: v.string(),
    seriesNumber: v.optional(v.string()),
    seriesDescription: v.optional(v.string()),
    // Instance-level
    sopInstanceUid: v.string(),
    sopClassUid: v.optional(v.string()),
    instanceNumber: v.optional(v.string()),
    rows: v.optional(v.number()),
    columns: v.optional(v.number()),
    filePath: v.string(),
    // Connection info
    sourceAeTitle: v.optional(v.string()),
    sourceIp: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ isDuplicate: boolean; studyId: string }> => {
    const ts = now();

    // ── 1. Duplicate check ────────────────────────────────────────────────
    const existingInstance = await ctx.db
      .query("dicomInboundInstances")
      .withIndex("by_sop_uid", (q) => q.eq("sopInstanceUid", args.sopInstanceUid))
      .first();

    if (existingInstance) {
      await ctx.db.insert("dicomGatewayLogs", {
        level: "warn",
        event: "instance_duplicate",
        message: `Duplicate SOPInstanceUID: ${args.sopInstanceUid}`,
        sourceAeTitle: args.sourceAeTitle,
        sourceIp: args.sourceIp,
        studyInstanceUid: args.studyInstanceUid,
        sopInstanceUid: args.sopInstanceUid,
        occurredAt: ts,
      });
      return { isDuplicate: true, studyId: existingInstance.inboundStudyId };
    }

    // ── 2. Upsert Study ───────────────────────────────────────────────────
    let studyDoc = await ctx.db
      .query("dicomInboundStudies")
      .withIndex("by_uid", (q) => q.eq("studyInstanceUid", args.studyInstanceUid))
      .unique();

    let studyId: Id<"dicomInboundStudies">;

    if (!studyDoc) {
      studyId = await ctx.db.insert("dicomInboundStudies", {
        studyInstanceUid: args.studyInstanceUid,
        patientName: args.patientName,
        patientId: args.patientId,
        patientBirthDate: args.patientBirthDate,
        patientSex: args.patientSex,
        studyDate: args.studyDate,
        studyTime: args.studyTime,
        studyDescription: args.studyDescription,
        accessionNumber: args.accessionNumber,
        modality: args.modality,
        seriesCount: 0,
        instanceCount: 0,
        status: "receiving",
        sourceAeTitle: args.sourceAeTitle,
        sourceIp: args.sourceIp,
        firstReceivedAt: ts,
        lastReceivedAt: ts,
      });
      studyDoc = await ctx.db.get(studyId);

      await ctx.db.insert("dicomGatewayLogs", {
        level: "info",
        event: "study_identified",
        message: `New study: ${args.studyInstanceUid} — ${args.patientName}`,
        sourceAeTitle: args.sourceAeTitle,
        sourceIp: args.sourceIp,
        studyInstanceUid: args.studyInstanceUid,
        occurredAt: ts,
      });
    } else {
      studyId = studyDoc._id;
      await ctx.db.patch(studyId, {
        instanceCount: studyDoc.instanceCount + 1,
        lastReceivedAt: ts,
        status: "receiving",
      });
    }

    // ── 3. Upsert Series ─────────────────────────────────────────────────
    let seriesDoc = await ctx.db
      .query("dicomInboundSeries")
      .withIndex("by_series_uid", (q) => q.eq("seriesInstanceUid", args.seriesInstanceUid))
      .first();

    let seriesId: Id<"dicomInboundSeries">;

    if (!seriesDoc) {
      seriesId = await ctx.db.insert("dicomInboundSeries", {
        inboundStudyId: studyId,
        studyInstanceUid: args.studyInstanceUid,
        seriesInstanceUid: args.seriesInstanceUid,
        seriesNumber: args.seriesNumber,
        seriesDescription: args.seriesDescription,
        modality: args.modality,
        instanceCount: 1,
        firstReceivedAt: ts,
      });

      // Increment study series count
      const latestStudy = await ctx.db.get(studyId);
      if (latestStudy) {
        await ctx.db.patch(studyId, {
          seriesCount: latestStudy.seriesCount + 1,
        });
      }

      await ctx.db.insert("dicomGatewayLogs", {
        level: "info",
        event: "series_identified",
        message: `New series: ${args.seriesInstanceUid} (${args.modality})`,
        sourceAeTitle: args.sourceAeTitle,
        sourceIp: args.sourceIp,
        studyInstanceUid: args.studyInstanceUid,
        occurredAt: ts,
      });
    } else {
      seriesId = seriesDoc._id;
      await ctx.db.patch(seriesId, { instanceCount: seriesDoc.instanceCount + 1 });
    }

    // ── 4. Insert Instance ────────────────────────────────────────────────
    await ctx.db.insert("dicomInboundInstances", {
      inboundStudyId: studyId,
      inboundSeriesId: seriesId,
      studyInstanceUid: args.studyInstanceUid,
      seriesInstanceUid: args.seriesInstanceUid,
      sopInstanceUid: args.sopInstanceUid,
      sopClassUid: args.sopClassUid,
      instanceNumber: args.instanceNumber,
      rows: args.rows,
      columns: args.columns,
      filePath: args.filePath,
      receivedAt: ts,
      isDuplicate: false,
    });

    await ctx.db.insert("dicomGatewayLogs", {
      level: "info",
      event: "instance_received",
      message: `Instance stored: ${args.sopInstanceUid}`,
      sourceAeTitle: args.sourceAeTitle,
      sourceIp: args.sourceIp,
      studyInstanceUid: args.studyInstanceUid,
      sopInstanceUid: args.sopInstanceUid,
      occurredAt: ts,
    });

    // ── 5. Update global stats ────────────────────────────────────────────
    const statusDoc = await ctx.db
      .query("dicomGatewayStatus")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    if (statusDoc) {
      await ctx.db.patch(statusDoc._id, {
        totalInstancesReceived: statusDoc.totalInstancesReceived + 1,
        updatedAt: ts,
      });
    }

    return { isDuplicate: false, studyId };
  },
});

// ─── Mark study READY (gateway → Convex after all instances received) ─────────

export const markStudyReady = mutation({
  args: {
    studyInstanceUid: v.string(),
    finalInstanceCount: v.optional(v.number()),
    finalSeriesCount: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<void> => {
    const ts = now();
    const studyDoc = await ctx.db
      .query("dicomInboundStudies")
      .withIndex("by_uid", (q) => q.eq("studyInstanceUid", args.studyInstanceUid))
      .unique();

    if (!studyDoc) return;

    await ctx.db.patch(studyDoc._id, {
      status: "ready",
      lastReceivedAt: ts,
      ...(args.finalInstanceCount !== undefined ? { instanceCount: args.finalInstanceCount } : {}),
      ...(args.finalSeriesCount !== undefined ? { seriesCount: args.finalSeriesCount } : {}),
    });

    await ctx.db.insert("dicomGatewayLogs", {
      level: "info",
      event: "study_ready",
      message: `Study READY: ${args.studyInstanceUid} — ${studyDoc.patientName} (${studyDoc.modality})`,
      studyInstanceUid: args.studyInstanceUid,
      occurredAt: ts,
    });

    // Update global stats
    const statusDoc = await ctx.db
      .query("dicomGatewayStatus")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    if (statusDoc) {
      await ctx.db.patch(statusDoc._id, {
        totalStudiesReceived: statusDoc.totalStudiesReceived + 1,
        lastStudyReceivedAt: ts,
        lastStudyPatientName: studyDoc.patientName,
        lastStudyModality: studyDoc.modality,
        updatedAt: ts,
      });
    }
  },
});

// ─── Log error (gateway → Convex) ────────────────────────────────────────────

export const logError = mutation({
  args: {
    event: v.string(),
    message: v.string(),
    sourceAeTitle: v.optional(v.string()),
    sourceIp: v.optional(v.string()),
    studyInstanceUid: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const ts = now();
    await ctx.db.insert("dicomGatewayLogs", {
      level: "error",
      event: args.event,
      message: args.message,
      sourceAeTitle: args.sourceAeTitle,
      sourceIp: args.sourceIp,
      studyInstanceUid: args.studyInstanceUid,
      occurredAt: ts,
    });

    const statusDoc = await ctx.db
      .query("dicomGatewayStatus")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();
    if (statusDoc) {
      await ctx.db.patch(statusDoc._id, {
        totalErrors: statusDoc.totalErrors + 1,
        updatedAt: ts,
      });
    }
  },
});

// ─── Admin queries ────────────────────────────────────────────────────────────

export const getGatewayStatus = query({
  args: {},
  handler: async (ctx) => {
    const status = await ctx.db
      .query("dicomGatewayStatus")
      .withIndex("by_key", (q) => q.eq("key", "singleton"))
      .unique();

    if (!status) return null;

    // Determine if truly online (heartbeat within last 90 seconds)
    const isOnline = status.lastHeartbeatAt
      ? Date.now() - new Date(status.lastHeartbeatAt).getTime() < 90_000
      : false;

    return { ...status, isOnline };
  },
});

export const getRecentLogs = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("dicomGatewayLogs")
      .withIndex("by_occurred_at")
      .order("desc")
      .take(args.limit ?? 100);
  },
});

export const getInboundStudies = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("dicomInboundStudies")
      .withIndex("by_first_received_at")
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const getInboundStudyDetail = query({
  args: { studyInstanceUid: v.string() },
  handler: async (ctx, args) => {
    const study = await ctx.db
      .query("dicomInboundStudies")
      .withIndex("by_uid", (q) => q.eq("studyInstanceUid", args.studyInstanceUid))
      .unique();
    if (!study) return null;

    const series = await ctx.db
      .query("dicomInboundSeries")
      .withIndex("by_study", (q) => q.eq("inboundStudyId", study._id))
      .collect();

    return { study, series };
  },
});
