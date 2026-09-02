/**
 * DICOM Gateway HTTP endpoints
 *
 * These HTTP Actions are called by the external Node.js DICOM Gateway server.
 * They are NOT the DICOM port — the gateway handles the TCP DICOM protocol
 * and calls these REST endpoints after processing each C-STORE instance.
 *
 * Endpoints:
 *   POST /dicom/heartbeat       — gateway liveness ping
 *   POST /dicom/echo            — log C-ECHO event
 *   POST /dicom/instance        — register received DICOM instance metadata
 *   POST /dicom/study-ready     — mark study as fully received (READY)
 *   POST /dicom/error           — log gateway error
 */
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { api } from "./_generated/api";

const http = httpRouter();

// ─── CORS helper ─────────────────────────────────────────────────────────────

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Gateway-Secret",
    "Content-Type": "application/json",
  };
}

function okJson(data: unknown): Response {
  return new Response(JSON.stringify(data), { status: 200, headers: corsHeaders() });
}

function errorJson(msg: string, status = 400): Response {
  return new Response(JSON.stringify({ error: msg }), { status, headers: corsHeaders() });
}

// ─── OPTIONS (preflight) ──────────────────────────────────────────────────────

http.route({
  path: "/dicom/heartbeat",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders() })),
});

http.route({
  path: "/dicom/echo",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders() })),
});

http.route({
  path: "/dicom/instance",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders() })),
});

http.route({
  path: "/dicom/study-ready",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders() })),
});

http.route({
  path: "/dicom/error",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: corsHeaders() })),
});

// ─── POST /dicom/heartbeat ────────────────────────────────────────────────────

http.route({
  path: "/dicom/heartbeat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json() as {
        aeTitle: string;
        port: number;
        serverIp?: string;
      };
      await ctx.runMutation(api.dicomGateway.heartbeat, {
        aeTitle: body.aeTitle,
        port: body.port,
        serverIp: body.serverIp,
      });
      return okJson({ ok: true });
    } catch (err) {
      return errorJson(err instanceof Error ? err.message : "Internal error", 500);
    }
  }),
});

// ─── POST /dicom/echo ─────────────────────────────────────────────────────────

http.route({
  path: "/dicom/echo",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json() as {
        sourceAeTitle?: string;
        sourceIp?: string;
        success: boolean;
      };
      await ctx.runMutation(api.dicomGateway.logEcho, {
        sourceAeTitle: body.sourceAeTitle,
        sourceIp: body.sourceIp,
        success: body.success,
      });
      return okJson({ ok: true });
    } catch (err) {
      return errorJson(err instanceof Error ? err.message : "Internal error", 500);
    }
  }),
});

// ─── POST /dicom/instance ─────────────────────────────────────────────────────

http.route({
  path: "/dicom/instance",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json() as {
        studyInstanceUid: string;
        patientName: string;
        patientId: string;
        patientBirthDate?: string;
        patientSex?: string;
        studyDate?: string;
        studyTime?: string;
        studyDescription?: string;
        accessionNumber?: string;
        modality: string;
        seriesInstanceUid: string;
        seriesNumber?: string;
        seriesDescription?: string;
        sopInstanceUid: string;
        sopClassUid?: string;
        instanceNumber?: string;
        rows?: number;
        columns?: number;
        filePath: string;
        sourceAeTitle?: string;
        sourceIp?: string;
      };

      const result = await ctx.runMutation(api.dicomGateway.receiveInstance, body);
      return okJson(result);
    } catch (err) {
      return errorJson(err instanceof Error ? err.message : "Internal error", 500);
    }
  }),
});

// ─── POST /dicom/study-ready ──────────────────────────────────────────────────

http.route({
  path: "/dicom/study-ready",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json() as {
        studyInstanceUid: string;
        finalInstanceCount?: number;
        finalSeriesCount?: number;
      };
      await ctx.runMutation(api.dicomGateway.markStudyReady, {
        studyInstanceUid: body.studyInstanceUid,
        finalInstanceCount: body.finalInstanceCount,
        finalSeriesCount: body.finalSeriesCount,
      });
      return okJson({ ok: true });
    } catch (err) {
      return errorJson(err instanceof Error ? err.message : "Internal error", 500);
    }
  }),
});

// ─── POST /dicom/error ────────────────────────────────────────────────────────

http.route({
  path: "/dicom/error",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.json() as {
        event: string;
        message: string;
        sourceAeTitle?: string;
        sourceIp?: string;
        studyInstanceUid?: string;
      };
      await ctx.runMutation(api.dicomGateway.logError, {
        event: body.event,
        message: body.message,
        sourceAeTitle: body.sourceAeTitle,
        sourceIp: body.sourceIp,
        studyInstanceUid: body.studyInstanceUid,
      });
      return okJson({ ok: true });
    } catch (err) {
      return errorJson(err instanceof Error ? err.message : "Internal error", 500);
    }
  }),
});

export default http;
