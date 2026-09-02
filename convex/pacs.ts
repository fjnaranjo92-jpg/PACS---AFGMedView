"use node";
/**
 * PACS Piloto — Backend Convex (Node runtime)
 *
 * Todas las llamadas a Orthanc se realizan ÚNICAMENTE desde este backend.
 * El navegador NUNCA llama directamente a Orthanc.
 *
 * Variables de entorno requeridas (configurar en Secrets del Back Office):
 *   ORTHANC_URL            - URL base de Orthanc (ej: http://192.168.1.100:8042)
 *   ORTHANC_USERNAME       - Usuario de Orthanc
 *   ORTHANC_PASSWORD       - Contraseña de Orthanc
 *   DICOMWEB_URL           - URL base DICOMweb (ej: http://192.168.1.100:8042/dicom-web)
 *   DICOMWEB_API_KEY       - API key adicional si aplica (puede quedar vacío)
 *   PACS_PILOT_ENABLED     - "true" para activar el módulo
 */

import { action } from "./_generated/server";
import { v } from "convex/values";

// ─── Tipos internos ────────────────────────────────────────────────────────────

type OrthancStudy = {
  ID: string;
  PatientID: string;
  PatientName: string;
  StudyDate: string;
  StudyTime: string;
  StudyDescription: string;
  AccessionNumber: string;
  StudyInstanceUID: string;
  RequestedProcedureDescription?: string;
  Modality?: string;
  NumberOfStudyRelatedSeries?: number;
  NumberOfStudyRelatedInstances?: number;
};

type DicomWebStudy = {
  "0020000D"?: { Value?: string[] };  // StudyInstanceUID
  "00100020"?: { Value?: string[] };  // PatientID
  "00100010"?: { Value?: Array<{ Alphabetic?: string }> }; // PatientName
  "00080020"?: { Value?: string[] };  // StudyDate
  "00080030"?: { Value?: string[] };  // StudyTime
  "00081030"?: { Value?: string[] };  // StudyDescription
  "00080050"?: { Value?: string[] };  // AccessionNumber
  "00080061"?: { Value?: string[] };  // ModalitiesInStudy
  "00201206"?: { Value?: number[] };  // NumberOfStudyRelatedSeries
  "00201208"?: { Value?: number[] };  // NumberOfStudyRelatedInstances
};

// ─── Helpers internos ─────────────────────────────────────────────────────────

function getConfig() {
  const baseUrl = process.env.ORTHANC_URL ?? "";
  const dicomWebUrl = process.env.DICOMWEB_URL ?? baseUrl ? `${baseUrl}/dicom-web` : "";
  const username = process.env.ORTHANC_USERNAME ?? "";
  const password = process.env.ORTHANC_PASSWORD ?? "";
  const apiKey = process.env.DICOMWEB_API_KEY ?? "";
  const enabled = process.env.PACS_PILOT_ENABLED === "true";

  return { baseUrl, dicomWebUrl, username, password, apiKey, enabled };
}

function buildHeaders(username: string, password: string, apiKey: string): HeadersInit {
  const headers: Record<string, string> = {
    "Accept": "application/json",
    "Content-Type": "application/json",
  };
  if (username && password) {
    const credentials = Buffer.from(`${username}:${password}`).toString("base64");
    headers["Authorization"] = `Basic ${credentials}`;
  }
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }
  return headers;
}

function normalizeDicomWebStudy(raw: DicomWebStudy) {
  const uid = raw["0020000D"]?.Value?.[0] ?? "";
  const patientId = raw["00100020"]?.Value?.[0] ?? "";
  const patientNameObj = raw["00100010"]?.Value?.[0];
  const patientName = typeof patientNameObj === "string"
    ? patientNameObj
    : patientNameObj?.Alphabetic ?? "";
  const studyDate = raw["00080020"]?.Value?.[0] ?? "";
  const studyTime = raw["00080030"]?.Value?.[0] ?? "";
  const studyDescription = raw["00081030"]?.Value?.[0] ?? "";
  const accessionNumber = raw["00080050"]?.Value?.[0] ?? "";
  const modality = (raw["00080061"]?.Value ?? []).join("/");
  const seriesCount = raw["00201206"]?.Value?.[0] ?? 0;
  const instanceCount = raw["00201208"]?.Value?.[0] ?? 0;

  return {
    studyInstanceUid: uid,
    patientId,
    patientName,
    studyDate,
    studyTime,
    studyDescription,
    accessionNumber,
    modality,
    seriesCount,
    instanceCount,
  };
}

// ─── 1. Verificar configuración PACS ─────────────────────────────────────────

export const checkConfig = action({
  args: {},
  handler: async (): Promise<{
    enabled: boolean;
    orthancConfigured: boolean;
    dicomWebConfigured: boolean;
    missingVars: string[];
  }> => {
    const cfg = getConfig();
    const missing: string[] = [];
    if (!cfg.baseUrl) missing.push("ORTHANC_URL");
    if (!cfg.username) missing.push("ORTHANC_USERNAME");
    if (!cfg.password) missing.push("ORTHANC_PASSWORD");
    if (!cfg.dicomWebUrl) missing.push("DICOMWEB_URL");

    return {
      enabled: cfg.enabled,
      orthancConfigured: !!cfg.baseUrl && !!cfg.username && !!cfg.password,
      dicomWebConfigured: !!cfg.dicomWebUrl,
      missingVars: missing,
    };
  },
});

// ─── 2. Prueba de conectividad ────────────────────────────────────────────────

export const testConnectivity = action({
  args: {},
  handler: async (): Promise<{
    backend: boolean;
    orthanc: boolean;
    dicomWeb: boolean;
    orthancVersion: string | null;
    orthancError: string | null;
    dicomWebError: string | null;
    studyCount: number;
    lastStudyDate: string | null;
  }> => {
    const cfg = getConfig();
    const result = {
      backend: true,
      orthanc: false,
      dicomWeb: false,
      orthancVersion: null as string | null,
      orthancError: null as string | null,
      dicomWebError: null as string | null,
      studyCount: 0,
      lastStudyDate: null as string | null,
    };

    if (!cfg.baseUrl) {
      result.orthancError = "ORTHANC_URL no configurado";
      result.dicomWebError = "DICOMWEB_URL no configurado";
      return result;
    }

    const headers = buildHeaders(cfg.username, cfg.password, cfg.apiKey);

    // Probar Orthanc /system
    try {
      const res = await fetch(`${cfg.baseUrl}/system`, {
        headers,
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        result.orthanc = true;
        const sys = await res.json() as { Version?: string };
        result.orthancVersion = sys.Version ?? "desconocida";
      } else {
        result.orthancError = `HTTP ${res.status}: ${res.statusText}`;
      }
    } catch (e) {
      result.orthancError = e instanceof Error ? e.message : String(e);
    }

    // Probar DICOMweb QIDO-RS
    if (cfg.dicomWebUrl) {
      try {
        const qidoHeaders = { ...headers as Record<string, string>, "Accept": "application/dicom+json" };
        const res = await fetch(`${cfg.dicomWebUrl}/studies?limit=1`, {
          headers: qidoHeaders,
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          result.dicomWeb = true;
          const studies = await res.json() as DicomWebStudy[];
          if (Array.isArray(studies)) {
            result.studyCount = studies.length;
            if (studies.length > 0) {
              const norm = normalizeDicomWebStudy(studies[0]);
              result.lastStudyDate = norm.studyDate || null;
            }
          }
        } else {
          result.dicomWebError = `HTTP ${res.status}: ${res.statusText}`;
        }
      } catch (e) {
        result.dicomWebError = e instanceof Error ? e.message : String(e);
      }
    } else {
      result.dicomWebError = "DICOMWEB_URL no configurado";
    }

    return result;
  },
});

// ─── 3. Listar estudios (QIDO-RS) ─────────────────────────────────────────────

export const listStudies = action({
  args: {
    patientId: v.optional(v.string()),
    patientName: v.optional(v.string()),
    studyDate: v.optional(v.string()),
    accessionNumber: v.optional(v.string()),
    studyDescription: v.optional(v.string()),
    modality: v.optional(v.string()),
    limit: v.optional(v.number()),
    offset: v.optional(v.number()),
  },
  handler: async (_ctx, args): Promise<{
    ok: boolean;
    error: string | null;
    studies: Array<{
      studyInstanceUid: string;
      patientId: string;
      patientName: string;
      studyDate: string;
      studyTime: string;
      studyDescription: string;
      accessionNumber: string;
      modality: string;
      seriesCount: number;
      instanceCount: number;
    }>;
    total: number;
  }> => {
    const cfg = getConfig();
    if (!cfg.dicomWebUrl) {
      return { ok: false, error: "DICOMWEB_URL no configurado. Configure las variables de entorno.", studies: [], total: 0 };
    }

    const params = new URLSearchParams();
    const limit = args.limit ?? 50;
    const offset = args.offset ?? 0;
    params.set("limit", String(limit));
    params.set("offset", String(offset));

    if (args.patientId) params.set("PatientID", args.patientId);
    if (args.patientName) params.set("PatientName", args.patientName);
    if (args.studyDate) params.set("StudyDate", args.studyDate);
    if (args.accessionNumber) params.set("AccessionNumber", args.accessionNumber);
    if (args.studyDescription) params.set("StudyDescription", args.studyDescription);
    if (args.modality) params.set("ModalitiesInStudy", args.modality);

    try {
      const headers = buildHeaders(cfg.username, cfg.password, cfg.apiKey);
      const res = await fetch(`${cfg.dicomWebUrl}/studies?${params.toString()}`, {
        headers: { ...headers as Record<string, string>, "Accept": "application/dicom+json" },
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        return { ok: false, error: `Orthanc respondió HTTP ${res.status}: ${body.slice(0, 200)}`, studies: [], total: 0 };
      }

      const raw = await res.json() as DicomWebStudy[];
      if (!Array.isArray(raw)) {
        return { ok: false, error: "Respuesta inesperada de DICOMweb", studies: [], total: 0 };
      }

      const studies = raw.map(normalizeDicomWebStudy);
      return { ok: true, error: null, studies, total: studies.length };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: `Error de conexión: ${msg}`, studies: [], total: 0 };
    }
  },
});

// ─── 4. Obtener series de un estudio (QIDO-RS) ────────────────────────────────

export const listSeries = action({
  args: { studyInstanceUid: v.string() },
  handler: async (_ctx, args): Promise<{
    ok: boolean;
    error: string | null;
    series: Array<{
      seriesInstanceUid: string;
      seriesNumber: string;
      modality: string;
      seriesDescription: string;
      instanceCount: number;
    }>;
  }> => {
    const cfg = getConfig();
    if (!cfg.dicomWebUrl) {
      return { ok: false, error: "DICOMWEB_URL no configurado", series: [] };
    }

    try {
      const headers = buildHeaders(cfg.username, cfg.password, cfg.apiKey);
      const url = `${cfg.dicomWebUrl}/studies/${args.studyInstanceUid}/series`;
      const res = await fetch(url, {
        headers: { ...headers as Record<string, string>, "Accept": "application/dicom+json" },
        signal: AbortSignal.timeout(20000),
      });

      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}: ${res.statusText}`, series: [] };
      }

      type DicomSeries = {
        "0020000E"?: { Value?: string[] };
        "00200011"?: { Value?: number[] };
        "00080060"?: { Value?: string[] };
        "0008103E"?: { Value?: string[] };
        "00201209"?: { Value?: number[] };
      };
      const raw = await res.json() as DicomSeries[];
      const series = raw.map((s) => ({
        seriesInstanceUid: s["0020000E"]?.Value?.[0] ?? "",
        seriesNumber: String(s["00200011"]?.Value?.[0] ?? ""),
        modality: s["00080060"]?.Value?.[0] ?? "",
        seriesDescription: s["0008103E"]?.Value?.[0] ?? "",
        instanceCount: s["00201209"]?.Value?.[0] ?? 0,
      }));

      return { ok: true, error: null, series };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), series: [] };
    }
  },
});

// ─── 5. Obtener instancias de una serie (QIDO-RS) ─────────────────────────────

export const listInstances = action({
  args: {
    studyInstanceUid: v.string(),
    seriesInstanceUid: v.string(),
  },
  handler: async (_ctx, args): Promise<{
    ok: boolean;
    error: string | null;
    instances: Array<{
      sopInstanceUid: string;
      instanceNumber: string;
    }>;
  }> => {
    const cfg = getConfig();
    if (!cfg.dicomWebUrl) {
      return { ok: false, error: "DICOMWEB_URL no configurado", instances: [] };
    }

    try {
      const headers = buildHeaders(cfg.username, cfg.password, cfg.apiKey);
      const url = `${cfg.dicomWebUrl}/studies/${args.studyInstanceUid}/series/${args.seriesInstanceUid}/instances`;
      const res = await fetch(url, {
        headers: { ...headers as Record<string, string>, "Accept": "application/dicom+json" },
        signal: AbortSignal.timeout(20000),
      });

      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}: ${res.statusText}`, instances: [] };
      }

      type DicomInstance = {
        "00080018"?: { Value?: string[] };
        "00200013"?: { Value?: number[] };
      };
      const raw = await res.json() as DicomInstance[];
      const instances = raw.map((i) => ({
        sopInstanceUid: i["00080018"]?.Value?.[0] ?? "",
        instanceNumber: String(i["00200013"]?.Value?.[0] ?? ""),
      }));

      return { ok: true, error: null, instances };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), instances: [] };
    }
  },
});

// ─── 6. Recuperar instancia DICOM como base64 (WADO-RS) ──────────────────────

export const retrieveInstance = action({
  args: {
    studyInstanceUid: v.string(),
    seriesInstanceUid: v.string(),
    sopInstanceUid: v.string(),
  },
  handler: async (_ctx, args): Promise<{
    ok: boolean;
    error: string | null;
    /** Base64-encoded DICOM file data */
    dicomBase64: string | null;
    contentType: string | null;
  }> => {
    const cfg = getConfig();
    if (!cfg.dicomWebUrl) {
      return { ok: false, error: "DICOMWEB_URL no configurado", dicomBase64: null, contentType: null };
    }

    try {
      const headers = buildHeaders(cfg.username, cfg.password, cfg.apiKey);
      const url = `${cfg.dicomWebUrl}/studies/${args.studyInstanceUid}/series/${args.seriesInstanceUid}/instances/${args.sopInstanceUid}`;
      const res = await fetch(url, {
        headers: { ...headers as Record<string, string>, "Accept": "application/dicom" },
        signal: AbortSignal.timeout(60000),
      });

      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}: ${res.statusText}`, dicomBase64: null, contentType: null };
      }

      const contentType = res.headers.get("Content-Type") ?? "application/dicom";
      const buffer = await res.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      return { ok: true, error: null, dicomBase64: base64, contentType };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), dicomBase64: null, contentType: null };
    }
  },
});

// ─── 7. Prueba E2E completa ────────────────────────────────────────────────────

export const runEndToEndTest = action({
  args: {},
  handler: async (): Promise<{
    steps: Array<{
      id: string;
      label: string;
      passed: boolean;
      detail: string;
    }>;
    allPassed: boolean;
  }> => {
    const cfg = getConfig();
    const steps: Array<{ id: string; label: string; passed: boolean; detail: string }> = [];

    // Paso 1: Backend disponible
    steps.push({ id: "backend", label: "Backend disponible", passed: true, detail: "Convex action ejecutándose correctamente" });

    // Paso 2: Orthanc disponible
    let orthancOk = false;
    let firstStudyUid = "";
    let firstSeriesUid = "";
    let firstSopUid = "";

    if (!cfg.baseUrl) {
      steps.push({ id: "orthanc", label: "Orthanc disponible", passed: false, detail: "ORTHANC_URL no configurado" });
    } else {
      try {
        const headers = buildHeaders(cfg.username, cfg.password, cfg.apiKey);
        const res = await fetch(`${cfg.baseUrl}/system`, { headers, signal: AbortSignal.timeout(8000) });
        orthancOk = res.ok;
        steps.push({ id: "orthanc", label: "Orthanc disponible", passed: res.ok, detail: res.ok ? `HTTP ${res.status}` : `HTTP ${res.status}: ${res.statusText}` });
      } catch (e) {
        steps.push({ id: "orthanc", label: "Orthanc disponible", passed: false, detail: e instanceof Error ? e.message : String(e) });
      }
    }

    // Paso 3: DICOMweb disponible
    let dicomWebOk = false;
    if (!cfg.dicomWebUrl) {
      steps.push({ id: "dicomweb", label: "DICOMweb disponible", passed: false, detail: "DICOMWEB_URL no configurado" });
    } else {
      try {
        const headers = buildHeaders(cfg.username, cfg.password, cfg.apiKey);
        const res = await fetch(`${cfg.dicomWebUrl}/studies?limit=1`, {
          headers: { ...headers as Record<string, string>, "Accept": "application/dicom+json" },
          signal: AbortSignal.timeout(10000),
        });
        dicomWebOk = res.ok;
        steps.push({ id: "dicomweb", label: "DICOMweb disponible", passed: res.ok, detail: res.ok ? `HTTP ${res.status}` : `HTTP ${res.status}: ${res.statusText}` });
      } catch (e) {
        steps.push({ id: "dicomweb", label: "DICOMweb disponible", passed: false, detail: e instanceof Error ? e.message : String(e) });
      }
    }

    // Paso 4: Estudios consultables
    let studiesOk = false;
    if (dicomWebOk) {
      try {
        const headers = buildHeaders(cfg.username, cfg.password, cfg.apiKey);
        const res = await fetch(`${cfg.dicomWebUrl}/studies?limit=5`, {
          headers: { ...headers as Record<string, string>, "Accept": "application/dicom+json" },
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const studies = await res.json() as DicomWebStudy[];
          studiesOk = Array.isArray(studies) && studies.length > 0;
          if (studiesOk && studies[0]) {
            firstStudyUid = studies[0]["0020000D"]?.Value?.[0] ?? "";
          }
          steps.push({ id: "studies", label: "Estudios consultables", passed: studiesOk, detail: studiesOk ? `${studies.length} estudio(s) encontrado(s)` : "No hay estudios en Orthanc todavía" });
        } else {
          steps.push({ id: "studies", label: "Estudios consultables", passed: false, detail: `HTTP ${res.status}` });
        }
      } catch (e) {
        steps.push({ id: "studies", label: "Estudios consultables", passed: false, detail: e instanceof Error ? e.message : String(e) });
      }
    } else {
      steps.push({ id: "studies", label: "Estudios consultables", passed: false, detail: "DICOMweb no disponible" });
    }

    // Paso 5: Estudio seleccionable
    if (!studiesOk || !firstStudyUid) {
      steps.push({ id: "select_study", label: "Estudio seleccionable", passed: false, detail: "No hay estudios disponibles para seleccionar" });
    } else {
      steps.push({ id: "select_study", label: "Estudio seleccionable", passed: true, detail: `StudyInstanceUID: ${firstStudyUid.slice(0, 20)}…` });
    }

    // Paso 6: Series consultables
    let seriesOk = false;
    if (studiesOk && firstStudyUid) {
      try {
        const headers = buildHeaders(cfg.username, cfg.password, cfg.apiKey);
        const res = await fetch(`${cfg.dicomWebUrl}/studies/${firstStudyUid}/series`, {
          headers: { ...headers as Record<string, string>, "Accept": "application/dicom+json" },
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          type DicomSer = { "0020000E"?: { Value?: string[] } };
          const seriesArr = await res.json() as DicomSer[];
          seriesOk = Array.isArray(seriesArr) && seriesArr.length > 0;
          if (seriesOk && seriesArr[0]) {
            firstSeriesUid = seriesArr[0]["0020000E"]?.Value?.[0] ?? "";
          }
          steps.push({ id: "series", label: "Series consultables", passed: seriesOk, detail: seriesOk ? `${seriesArr.length} series encontradas` : "No hay series" });
        } else {
          steps.push({ id: "series", label: "Series consultables", passed: false, detail: `HTTP ${res.status}` });
        }
      } catch (e) {
        steps.push({ id: "series", label: "Series consultables", passed: false, detail: e instanceof Error ? e.message : String(e) });
      }
    } else {
      steps.push({ id: "series", label: "Series consultables", passed: false, detail: "No hay estudio base" });
    }

    // Paso 7: Imagen recuperable
    let instanceOk = false;
    if (seriesOk && firstStudyUid && firstSeriesUid) {
      try {
        const headers = buildHeaders(cfg.username, cfg.password, cfg.apiKey);
        const res = await fetch(`${cfg.dicomWebUrl}/studies/${firstStudyUid}/series/${firstSeriesUid}/instances?limit=1`, {
          headers: { ...headers as Record<string, string>, "Accept": "application/dicom+json" },
          signal: AbortSignal.timeout(10000),
        });
        if (res.ok) {
          type DicomInst = { "00080018"?: { Value?: string[] } };
          const instArr = await res.json() as DicomInst[];
          instanceOk = Array.isArray(instArr) && instArr.length > 0;
          if (instanceOk && instArr[0]) {
            firstSopUid = instArr[0]["00080018"]?.Value?.[0] ?? "";
          }
          steps.push({ id: "instance", label: "Imagen recuperable", passed: instanceOk, detail: instanceOk ? `SOPInstanceUID: ${firstSopUid.slice(0, 20)}…` : "No hay instancias" });
        } else {
          steps.push({ id: "instance", label: "Imagen recuperable", passed: false, detail: `HTTP ${res.status}` });
        }
      } catch (e) {
        steps.push({ id: "instance", label: "Imagen recuperable", passed: false, detail: e instanceof Error ? e.message : String(e) });
      }
    } else {
      steps.push({ id: "instance", label: "Imagen recuperable", passed: false, detail: "No hay serie base" });
    }

    // Paso 8: Visor puede abrir imagen (verificamos que recuperamos el DICOM)
    let viewerOk = false;
    if (instanceOk && firstStudyUid && firstSeriesUid && firstSopUid) {
      try {
        const headers = buildHeaders(cfg.username, cfg.password, cfg.apiKey);
        const url = `${cfg.dicomWebUrl}/studies/${firstStudyUid}/series/${firstSeriesUid}/instances/${firstSopUid}`;
        const res = await fetch(url, {
          method: "HEAD",
          headers: { ...headers as Record<string, string>, "Accept": "application/dicom" },
          signal: AbortSignal.timeout(15000),
        });
        viewerOk = res.ok;
        steps.push({ id: "viewer", label: "Visor puede abrir imagen", passed: viewerOk, detail: viewerOk ? `Imagen DICOM accesible (${res.headers.get("Content-Length") ?? "?"} bytes)` : `HTTP ${res.status}` });
      } catch (e) {
        steps.push({ id: "viewer", label: "Visor puede abrir imagen", passed: false, detail: e instanceof Error ? e.message : String(e) });
      }
    } else {
      steps.push({ id: "viewer", label: "Visor puede abrir imagen", passed: false, detail: "No hay instancia base para verificar" });
    }

    const allPassed = steps.every((s) => s.passed);
    return { steps, allPassed };
  },
});

// ─── 9. Prueba de conectividad rápida para el contador total de estudios ──────

export const getStudyCount = action({
  args: {},
  handler: async (): Promise<{ ok: boolean; count: number; error: string | null }> => {
    const cfg = getConfig();
    if (!cfg.dicomWebUrl) return { ok: false, count: 0, error: "DICOMWEB_URL no configurado" };

    try {
      const headers = buildHeaders(cfg.username, cfg.password, cfg.apiKey);
      const res = await fetch(`${cfg.dicomWebUrl}/studies?limit=1000`, {
        headers: { ...headers as Record<string, string>, "Accept": "application/dicom+json" },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) return { ok: false, count: 0, error: `HTTP ${res.status}` };
      const arr = await res.json() as unknown[];
      return { ok: true, count: Array.isArray(arr) ? arr.length : 0, error: null };
    } catch (e) {
      return { ok: false, count: 0, error: e instanceof Error ? e.message : String(e) };
    }
  },
});

// ─── 10. Obtener info de configuración (sin credenciales) ─────────────────────

export const getConfigInfo = action({
  args: {},
  handler: async (): Promise<{
    orthancUrl: string;
    dicomWebUrl: string;
    hasCredentials: boolean;
    hasApiKey: boolean;
    pilotEnabled: boolean;
    aeTitle: string;
    dicomPort: string;
  }> => {
    const cfg = getConfig();
    return {
      // Ocultar credenciales — solo informar si están configuradas
      orthancUrl: cfg.baseUrl || "(no configurado)",
      dicomWebUrl: cfg.dicomWebUrl || "(no configurado)",
      hasCredentials: !!(cfg.username && cfg.password),
      hasApiKey: !!cfg.apiKey,
      pilotEnabled: cfg.enabled,
      aeTitle: process.env.DICOM_AE_TITLE ?? "AFGMEDVIEW_TEST",
      dicomPort: process.env.DICOM_PORT ?? "4242",
    };
  },
});
