#!/usr/bin/env node
/**
 * AFGMedView DCMTK Proxy Server
 * ==============================
 * Servidor HTTP local (puerto 4244) que actúa como puente entre el
 * frontend web de AFGMedView y las herramientas DCMTK instaladas en Windows.
 *
 * Endpoints:
 *   GET  /status            — información del proxy y config
 *   POST /echo              — C-ECHO (echoscu)
 *   POST /find              — C-FIND (findscu)
 *   POST /get               — C-GET con SSE de progreso (getscu)
 *   POST /cancel            — cancela descarga activa
 *   GET  /cache             — lista estudios en caché local
 *   DELETE /cache/:uid      — elimina estudio del caché
 *   POST /config            — guarda configuración PACS
 *   GET  /config            — obtiene configuración actual
 *
 * SEGURIDAD:
 *   - Nunca usa shell: true — siempre spawn con args array separados
 *   - Valida todos los parámetros antes de ejecutar
 *   - Solo acepta conexiones de localhost (127.0.0.1)
 *
 * Uso:
 *   node dcmtk-proxy.js
 *   o con configuración personalizada:
 *   DCMTK_BIN=C:\dcmtk-3.7.0-win64-dynamic\bin node dcmtk-proxy.js
 */

"use strict";

const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ─── Configuration ────────────────────────────────────────────────────────────

// Load config file if it exists
const CONFIG_FILE = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
  "AFGMedView",
  "pacs-config.json"
);

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    }
  } catch { /* use defaults */ }
  return {};
}

function saveConfig(cfg) {
  try {
    const dir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), "utf8");
  } catch (e) {
    console.error("[WARN] Cannot save config:", e.message);
  }
}

let savedConfig = loadConfig();

const DEFAULTS = {
  pacsName:   "DCM4CHEE",
  pacsIp:     "10.64.73.44",
  pacsPort:   "11112",
  calledAet:  "DCM4CHEE",
  callingAet: "AFGMEDVIEW",
  dcmtkBin:   process.env.DCMTK_BIN || "C:\\dcmtk-3.7.0-win64-dynamic\\bin",
  retrieveMethod: "C-GET",
};

function getConfig() {
  return { ...DEFAULTS, ...savedConfig };
}

// DICOM cache directory
const CACHE_BASE = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
  "AFGMedView",
  "dicom-cache"
);

const PORT = parseInt(process.env.DCMTK_PROXY_PORT || "4244", 10);

// Active download processes (for cancellation)
const activeDownloads = new Map(); // uid → { process, abortController }

// ─── Logs ────────────────────────────────────────────────────────────────────

const LOG_FILE = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
  "AFGMedView",
  "logs",
  "dcmtk-proxy.log"
);

function ensureLogDir() {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  } catch { /* ignore */ }
}

function log(level, event, message, extra = {}) {
  const ts = new Date().toISOString();
  const line = `${ts} [${level.toUpperCase()}][${event}] ${message}`;
  console.log(line);
  // Async file log
  try {
    fs.appendFileSync(LOG_FILE, line + (Object.keys(extra).length ? " " + JSON.stringify(extra) : "") + "\n");
  } catch { /* ignore */ }
}

// ─── Input validation ─────────────────────────────────────────────────────────

function validateIp(ip) {
  // Accepts IPv4 or hostname (no shell special chars)
  return /^[a-zA-Z0-9.\-_]+$/.test(ip) && ip.length <= 64;
}

function validatePort(port) {
  const n = parseInt(port, 10);
  return !isNaN(n) && n >= 1 && n <= 65535;
}

function validateAet(aet) {
  // AE Title: max 16 chars, alphanumeric + underscore + hyphen
  return /^[A-Z0-9_\-]{1,16}$/.test(aet.toUpperCase());
}

function validateUid(uid) {
  // DICOM UID: digits and dots only, max 64 chars
  return /^[0-9.]{1,64}$/.test(uid);
}

function validateDate(d) {
  if (!d) return true;
  return /^\d{8}(-\d{8})?$/.test(d); // YYYYMMDD or YYYYMMDD-YYYYMMDD
}

// ─── DCMTK helpers ────────────────────────────────────────────────────────────

function dcmtkBin(tool) {
  const cfg = getConfig();
  const binDir = cfg.dcmtkBin || DEFAULTS.dcmtkBin;
  // On Windows use .exe extension, on Unix try without
  if (process.platform === "win32") {
    return path.join(binDir, tool + ".exe");
  }
  // Fallback for Linux/macOS (dcmtk installed via package manager)
  const linuxPath = path.join(binDir, tool);
  if (fs.existsSync(linuxPath)) return linuxPath;
  return tool; // from PATH
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ─── C-ECHO ───────────────────────────────────────────────────────────────────

function runEcho(cfg) {
  return new Promise((resolve) => {
    const { pacsIp, pacsPort, calledAet, callingAet } = cfg;
    const exe = dcmtkBin("echoscu");
    const args = [
      "-v",
      "-aet", callingAet.toUpperCase(),
      "-aec", calledAet.toUpperCase(),
      pacsIp,
      pacsPort,
    ];

    log("info", "c_echo_start", `echoscu ${args.join(" ")}`);

    const startMs = Date.now();
    const proc = spawn(exe, args, { shell: false });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill();
      resolve({
        success: false,
        status: "timeout",
        message: "Timeout: el PACS no respondió en 15 segundos",
        durationMs: Date.now() - startMs,
        raw: stderr,
      });
    }, 15000);

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startMs;
      log("info", "c_echo_done", `exit=${code} (${durationMs}ms)`);

      if (code === 0 && (stderr.includes("Received Echo Response") || stdout.includes("Received Echo Response") ||
          stderr.includes("I: Received Echo Response") || stderr.includes("Releasing Association"))) {
        resolve({
          success: true,
          status: "connected",
          message: "Conexión exitosa — C-ECHO respondido correctamente",
          durationMs,
          raw: stderr || stdout,
        });
      } else if (stderr.includes("refused") || stderr.includes("Connection refused")) {
        resolve({ success: false, status: "refused", message: "Conexión rechazada — verifique IP y puerto", durationMs, raw: stderr });
      } else if (stderr.includes("Association Rejected") || stderr.includes("A-ASSOCIATE-RJ")) {
        resolve({ success: false, status: "rejected", message: "Asociación rechazada — verifique AE Titles", durationMs, raw: stderr });
      } else if (code !== 0) {
        resolve({ success: false, status: "error", message: `Error de asociación (código ${code})`, durationMs, raw: stderr || stdout });
      } else {
        resolve({
          success: true,
          status: "connected",
          message: "C-ECHO completado",
          durationMs,
          raw: stderr || stdout,
        });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      const isNotFound = err.code === "ENOENT";
      resolve({
        success: false,
        status: "not_found",
        message: isNotFound
          ? `echoscu no encontrado en: ${exe}\nConfigure la ruta de DCMTK en Configuración PACS`
          : `Error al ejecutar echoscu: ${err.message}`,
        durationMs: Date.now() - startMs,
        raw: err.message,
      });
    });
  });
}

// ─── C-FIND parser ────────────────────────────────────────────────────────────

/**
 * Parsea la salida de findscu y devuelve un array de estudios.
 * findscu escribe en stderr líneas como:
 *   W: (0010,0020) LO [1234567] Patient ID
 *   W: (0020,000d) UI [1.2.3...] Study Instance UID
 */
function parseFindscuOutput(output) {
  const studies = [];
  let current = null;

  const lines = output.split("\n");

  for (const rawLine of lines) {
    // New result block separator
    if (rawLine.includes("---------------------------") ||
        rawLine.match(/^W:\s*$/) ||
        rawLine.includes("Find Response")) {
      if (current && current.studyInstanceUid) {
        studies.push({ ...current });
      }
      current = {
        studyInstanceUid: "",
        patientName: "",
        patientId: "",
        studyDate: "",
        studyDescription: "",
        modality: "",
        accessionNumber: "",
      };
      continue;
    }

    if (!current) {
      current = {
        studyInstanceUid: "",
        patientName: "",
        patientId: "",
        studyDate: "",
        studyDescription: "",
        modality: "",
        accessionNumber: "",
      };
    }

    // Parse tag line: patterns like:
    // W: (0010,0020) LO [PATIENTID] Patient ID
    // I: (0010,0020) LO [PATIENTID] Patient ID
    const tagMatch = rawLine.match(/[WI]:\s*\(([0-9a-fA-F]{4},[0-9a-fA-F]{4})\)\s+\w{2}\s+\[([^\]]*)\]/);
    if (!tagMatch) continue;

    const tag = tagMatch[1].replace(",", "").toLowerCase();
    const value = tagMatch[2].trim();

    switch (tag) {
      case "00100010": current.patientName = value; break;
      case "00100020": current.patientId = value; break;
      case "00080020": current.studyDate = value; break;
      case "00081030": current.studyDescription = value; break;
      case "00080061":
      case "00080060": current.modality = value; break;
      case "00080050": current.accessionNumber = value; break;
      case "0020000d": current.studyInstanceUid = value; break;
    }
  }

  // Push last record
  if (current && current.studyInstanceUid) {
    studies.push({ ...current });
  }

  // Remove duplicates by studyInstanceUid
  const seen = new Set();
  return studies.filter((s) => {
    if (!s.studyInstanceUid || seen.has(s.studyInstanceUid)) return false;
    seen.add(s.studyInstanceUid);
    return true;
  });
}

// ─── C-FIND ───────────────────────────────────────────────────────────────────

function buildFindArgs(cfg, filters) {
  const { pacsIp, pacsPort, calledAet, callingAet } = cfg;

  const args = [
    "-v",
    "-aet", callingAet.toUpperCase(),
    "-aec", calledAet.toUpperCase(),
    "-S",                    // Study level
    "-k", "0008,0052=STUDY", // Query Retrieve Level
    // Fields to retrieve
    "-k", "0020,000D=",      // StudyInstanceUID
    "-k", "0010,0010=",      // PatientName
    "-k", "0010,0020=",      // PatientID
    "-k", "0008,0020=",      // StudyDate
    "-k", "0008,1030=",      // StudyDescription
    "-k", "0008,0061=",      // ModalitiesInStudy
    "-k", "0008,0050=",      // AccessionNumber
  ];

  // Dynamic filters
  if (filters.patientId) {
    args.push("-k", `0010,0020=${filters.patientId}`);
  }
  if (filters.patientName) {
    // DICOM wildcard: append * for partial match
    const name = filters.patientName.endsWith("*") ? filters.patientName : `${filters.patientName}*`;
    args.push("-k", `0010,0010=${name}`);
  }
  if (filters.accessionNumber) {
    args.push("-k", `0008,0050=${filters.accessionNumber}`);
  }
  if (filters.studyDate) {
    args.push("-k", `0008,0020=${filters.studyDate}`);
  }
  if (filters.modality) {
    args.push("-k", `0008,0061=${filters.modality}`);
  }

  args.push(pacsIp, pacsPort);
  return args;
}

function runFind(cfg, filters) {
  return new Promise((resolve) => {
    const exe = dcmtkBin("findscu");
    const args = buildFindArgs(cfg, filters);

    log("info", "c_find_start", `findscu ${args.join(" ")}`);

    const startMs = Date.now();
    const proc = spawn(exe, args, { shell: false });

    let stdout = "";
    let stderr = "";

    const timer = setTimeout(() => {
      proc.kill();
      resolve({ ok: false, error: "Timeout: C-FIND no completó en 30 segundos", studies: [] });
    }, 30000);

    proc.stdout.on("data", (d) => { stdout += d.toString(); });
    proc.stderr.on("data", (d) => { stderr += d.toString(); });

    proc.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - startMs;
      log("info", "c_find_done", `exit=${code} (${durationMs}ms) output=${stderr.length + stdout.length} bytes`);

      if (code !== 0 && !stderr.includes("Find Response") && !stdout.includes("Find Response")) {
        const combined = stderr + stdout;
        let errMsg = `C-FIND falló (código ${code})`;
        if (combined.includes("refused")) errMsg = "Conexión rechazada — verifique IP y puerto";
        else if (combined.includes("A-ASSOCIATE-RJ")) errMsg = "Asociación rechazada — verifique AE Titles";
        else if (!combined) errMsg = `findscu no disponible — verifique ruta DCMTK`;
        resolve({ ok: false, error: errMsg, studies: [] });
        return;
      }

      const combined = stderr + "\n" + stdout;
      const studies = parseFindscuOutput(combined);
      log("info", "c_find_results", `${studies.length} estudios encontrados`);
      resolve({ ok: true, error: null, studies, durationMs });
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        error: err.code === "ENOENT"
          ? `findscu no encontrado en: ${exe}\nConfigure la ruta DCMTK en Configuración PACS`
          : `Error al ejecutar findscu: ${err.message}`,
        studies: [],
      });
    });
  });
}

// ─── C-GET with SSE progress ─────────────────────────────────────────────────

function countDcmFiles(dir) {
  try {
    if (!fs.existsSync(dir)) return 0;
    let count = 0;
    const scan = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        if (entry.isDirectory()) scan(path.join(d, entry.name));
        else if (entry.name.endsWith(".dcm") || entry.name.endsWith(".DCM")) count++;
      }
    };
    scan(dir);
    return count;
  } catch { return 0; }
}

function getDirSizeBytes(dir) {
  try {
    if (!fs.existsSync(dir)) return 0;
    let total = 0;
    const scan = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        if (entry.isDirectory()) scan(path.join(d, entry.name));
        else {
          try { total += fs.statSync(path.join(d, entry.name)).size; } catch { /* ignore */ }
        }
      }
    };
    scan(dir);
    return total;
  } catch { return 0; }
}

function startGet(cfg, studyUid, res) {
  const { pacsIp, pacsPort, calledAet, callingAet } = cfg;
  const sanitizedUid = studyUid.replace(/[^0-9.]/g, "_");
  const studyDir = path.join(CACHE_BASE, sanitizedUid);
  ensureDir(studyDir);

  const args = [
    "-v",
    "-S",                                  // Study level
    "-aet", callingAet.toUpperCase(),
    "-aec", calledAet.toUpperCase(),
    "-od", studyDir,                        // Output directory
    "-k", "0008,0052=STUDY",
    "-k", `0020,000D=${studyUid}`,
    pacsIp,
    pacsPort,
  ];

  log("info", "c_get_start", `getscu study=${studyUid}`);

  const exe = dcmtkBin("getscu");
  const proc = spawn(exe, args, { shell: false });
  activeDownloads.set(studyUid, proc);

  // SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  function sendEvent(type, data) {
    if (!res.writableEnded) {
      res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    }
  }

  sendEvent("start", { studyUid, outputDir: studyDir });

  let stderr = "";
  let stdout = "";
  let lastFileCount = 0;

  // Poll file count every second for live progress
  const pollInterval = setInterval(() => {
    const count = countDcmFiles(studyDir);
    const sizeBytes = getDirSizeBytes(studyDir);
    if (count !== lastFileCount) {
      lastFileCount = count;
      sendEvent("progress", { filesReceived: count, sizeBytes, studyDir });
    }
  }, 1000);

  proc.stdout.on("data", (d) => {
    stdout += d.toString();
    sendEvent("log", { text: d.toString().trim() });
  });

  proc.stderr.on("data", (d) => {
    const text = d.toString();
    stderr += text;
    // Send relevant log lines to frontend
    const trimmed = text.trim();
    if (trimmed && !trimmed.startsWith("I: Association")) {
      sendEvent("log", { text: trimmed });
    }
  });

  proc.on("error", (err) => {
    clearInterval(pollInterval);
    activeDownloads.delete(studyUid);
    const isNotFound = err.code === "ENOENT";
    sendEvent("error", {
      message: isNotFound
        ? `getscu no encontrado en: ${exe}\nConfigure la ruta DCMTK en Configuración PACS`
        : `Error al ejecutar getscu: ${err.message}`,
    });
    if (!res.writableEnded) res.end();
  });

  proc.on("close", (code) => {
    clearInterval(pollInterval);
    activeDownloads.delete(studyUid);

    const finalCount = countDcmFiles(studyDir);
    const finalSize = getDirSizeBytes(studyDir);

    log("info", "c_get_done", `exit=${code} files=${finalCount} size=${finalSize}`);

    if (code === 0 || finalCount > 0) {
      // Index the downloaded files
      const indexed = indexStudyDir(studyDir, studyUid);
      sendEvent("done", {
        success: true,
        filesReceived: finalCount,
        sizeBytes: finalSize,
        studyDir,
        studyUid,
        indexed,
      });
    } else {
      const combined = stderr + stdout;
      let errMsg = `C-GET falló (código ${code})`;
      if (combined.includes("refused")) errMsg = "Conexión rechazada";
      else if (combined.includes("A-ASSOCIATE-RJ")) errMsg = "Asociación rechazada — verifique AE Titles";
      sendEvent("error", { message: errMsg, raw: combined.slice(0, 500) });
    }

    if (!res.writableEnded) res.end();
  });
}

// ─── Indexing ─────────────────────────────────────────────────────────────────

/**
 * Scans a study directory and returns a structured index.
 * Groups files by series directory (getscu places them flat or by series).
 */
function indexStudyDir(studyDir, studyUid) {
  const result = {
    studyUid,
    studyDir,
    series: [],
    totalFiles: 0,
    totalValidDicom: 0,
  };

  if (!fs.existsSync(studyDir)) return result;

  // Collect all .dcm files recursively
  const allFiles = [];
  const scanDir = (dir, depth = 0) => {
    if (depth > 5) return;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(full, depth + 1);
        } else if (
          entry.name.toLowerCase().endsWith(".dcm") ||
          entry.name.toLowerCase().endsWith(".ima") ||
          !entry.name.includes(".") // DICOM files without extension
        ) {
          allFiles.push(full);
        }
      }
    } catch { /* ignore */ }
  };

  scanDir(studyDir);
  result.totalFiles = allFiles.length;

  // Group by series using directory name as proxy for SeriesInstanceUID
  // (getscu typically places files as {seriesUID}/{sopUID}.dcm or flat)
  const seriesMap = new Map();

  for (const filePath of allFiles) {
    const dir = path.dirname(filePath);
    const seriesKey = dir === studyDir ? "default" : path.basename(dir);

    if (!seriesMap.has(seriesKey)) {
      seriesMap.set(seriesKey, { seriesDir: dir, files: [] });
    }
    seriesMap.get(seriesKey).files.push(filePath);
    result.totalValidDicom++;
  }

  result.series = Array.from(seriesMap.entries()).map(([key, { seriesDir, files }]) => ({
    seriesKey: key,
    seriesDir,
    fileCount: files.length,
    files: files.sort(), // sort by filename (usually contains instance number)
  }));

  log("info", "index_done", `studyDir=${studyDir} series=${result.series.length} files=${result.totalValidDicom}`);
  return result;
}

// ─── Cache management ─────────────────────────────────────────────────────────

function listCache() {
  ensureDir(CACHE_BASE);
  const entries = [];

  try {
    for (const uid of fs.readdirSync(CACHE_BASE)) {
      const studyDir = path.join(CACHE_BASE, uid);
      const stat = fs.statSync(studyDir);
      if (!stat.isDirectory()) continue;

      const fileCount = countDcmFiles(studyDir);
      const sizeBytes = getDirSizeBytes(studyDir);

      entries.push({
        studyUid: uid.replace(/_/g, "."),
        studyDir,
        fileCount,
        sizeBytes,
        indexedAt: stat.mtime.toISOString(),
      });
    }
  } catch { /* ignore */ }

  return entries;
}

function deleteFromCache(studyUid) {
  const sanitized = studyUid.replace(/[^0-9.]/g, "_");
  const studyDir = path.join(CACHE_BASE, sanitized);
  if (!fs.existsSync(studyDir)) {
    return { ok: false, error: "Estudio no encontrado en caché" };
  }
  try {
    fs.rmSync(studyDir, { recursive: true, force: true });
    log("info", "cache_delete", `Deleted ${studyDir}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── HTTP Server ──────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk.toString(); });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // Only allow localhost connections for security
  const remoteAddr = req.socket.remoteAddress || "";
  if (!remoteAddr.includes("127.0.0.1") && !remoteAddr.includes("::1") && !remoteAddr.includes("localhost")) {
    log("warn", "blocked_remote", `Blocked connection from ${remoteAddr}`);
    sendJson(res, 403, { error: "Solo conexiones locales permitidas" });
    return;
  }

  const url = req.url || "/";
  const urlParts = url.split("?")[0].replace(/\/+$/, "");

  log("info", "request", `${req.method} ${url}`);

  try {
    // ── GET /status ────────────────────────────────────────────────────────
    if (req.method === "GET" && urlParts === "/status") {
      const cfg = getConfig();
      sendJson(res, 200, {
        ok: true,
        version: "1.0.0",
        cacheBase: CACHE_BASE,
        configFile: CONFIG_FILE,
        logFile: LOG_FILE,
        activeDownloads: activeDownloads.size,
        config: {
          ...cfg,
          // Never expose sensitive data
        },
      });
      return;
    }

    // ── GET /config ────────────────────────────────────────────────────────
    if (req.method === "GET" && urlParts === "/config") {
      sendJson(res, 200, { ok: true, config: getConfig() });
      return;
    }

    // ── POST /config ───────────────────────────────────────────────────────
    if (req.method === "POST" && urlParts === "/config") {
      const body = await readBody(req);
      const newCfg = {};

      if (body.pacsName !== undefined) newCfg.pacsName = String(body.pacsName).slice(0, 64);
      if (body.pacsIp !== undefined) {
        if (!validateIp(body.pacsIp)) {
          sendJson(res, 400, { error: "IP inválida" }); return;
        }
        newCfg.pacsIp = body.pacsIp;
      }
      if (body.pacsPort !== undefined) {
        if (!validatePort(body.pacsPort)) {
          sendJson(res, 400, { error: "Puerto inválido (1-65535)" }); return;
        }
        newCfg.pacsPort = String(body.pacsPort);
      }
      if (body.calledAet !== undefined) {
        if (!validateAet(body.calledAet)) {
          sendJson(res, 400, { error: "Called AE Title inválido (1-16 caracteres alfanuméricos)" }); return;
        }
        newCfg.calledAet = body.calledAet.toUpperCase();
      }
      if (body.callingAet !== undefined) {
        if (!validateAet(body.callingAet)) {
          sendJson(res, 400, { error: "Calling AE Title inválido (1-16 caracteres alfanuméricos)" }); return;
        }
        newCfg.callingAet = body.callingAet.toUpperCase();
      }
      if (body.dcmtkBin !== undefined) newCfg.dcmtkBin = String(body.dcmtkBin).slice(0, 512);
      if (body.retrieveMethod !== undefined) newCfg.retrieveMethod = body.retrieveMethod;

      savedConfig = { ...savedConfig, ...newCfg };
      saveConfig(savedConfig);
      log("info", "config_saved", "Configuration updated");
      sendJson(res, 200, { ok: true, config: getConfig() });
      return;
    }

    // ── POST /echo ─────────────────────────────────────────────────────────
    if (req.method === "POST" && urlParts === "/echo") {
      const body = await readBody(req);
      const cfg = { ...getConfig(), ...extractCfgOverride(body) };

      // Validate
      if (!validateIp(cfg.pacsIp)) { sendJson(res, 400, { error: "IP inválida" }); return; }
      if (!validatePort(cfg.pacsPort)) { sendJson(res, 400, { error: "Puerto inválido" }); return; }
      if (!validateAet(cfg.calledAet)) { sendJson(res, 400, { error: "Called AET inválido" }); return; }
      if (!validateAet(cfg.callingAet)) { sendJson(res, 400, { error: "Calling AET inválido" }); return; }

      const result = await runEcho(cfg);
      sendJson(res, 200, result);
      return;
    }

    // ── POST /find ─────────────────────────────────────────────────────────
    if (req.method === "POST" && urlParts === "/find") {
      const body = await readBody(req);
      const cfg = { ...getConfig(), ...extractCfgOverride(body) };

      // Validate
      if (!validateIp(cfg.pacsIp)) { sendJson(res, 400, { error: "IP inválida" }); return; }
      if (!validatePort(cfg.pacsPort)) { sendJson(res, 400, { error: "Puerto inválido" }); return; }
      if (!validateAet(cfg.calledAet)) { sendJson(res, 400, { error: "Called AET inválido" }); return; }
      if (!validateAet(cfg.callingAet)) { sendJson(res, 400, { error: "Calling AET inválido" }); return; }

      // Validate filter params
      const filters = {};
      if (body.patientId) filters.patientId = String(body.patientId).slice(0, 64).replace(/[<>|&;`${}]/g, "");
      if (body.patientName) filters.patientName = String(body.patientName).slice(0, 64).replace(/[<>|&;`${}]/g, "");
      if (body.accessionNumber) filters.accessionNumber = String(body.accessionNumber).slice(0, 64).replace(/[<>|&;`${}]/g, "");
      if (body.studyDate) {
        if (!validateDate(body.studyDate)) { sendJson(res, 400, { error: "Formato de fecha inválido (YYYYMMDD o YYYYMMDD-YYYYMMDD)" }); return; }
        filters.studyDate = body.studyDate;
      }
      if (body.modality) filters.modality = String(body.modality).replace(/[^A-Z]/gi, "").slice(0, 10);

      const result = await runFind(cfg, filters);
      sendJson(res, result.ok ? 200 : 500, result);
      return;
    }

    // ── POST /get (SSE streaming) ──────────────────────────────────────────
    if (req.method === "POST" && urlParts === "/get") {
      const body = await readBody(req);
      const cfg = { ...getConfig(), ...extractCfgOverride(body) };

      if (!body.studyUid || !validateUid(body.studyUid)) {
        sendJson(res, 400, { error: "studyUid inválido" }); return;
      }
      if (!validateIp(cfg.pacsIp)) { sendJson(res, 400, { error: "IP inválida" }); return; }
      if (!validatePort(cfg.pacsPort)) { sendJson(res, 400, { error: "Puerto inválido" }); return; }
      if (!validateAet(cfg.calledAet)) { sendJson(res, 400, { error: "Called AET inválido" }); return; }
      if (!validateAet(cfg.callingAet)) { sendJson(res, 400, { error: "Calling AET inválido" }); return; }

      // Check if already downloading
      if (activeDownloads.has(body.studyUid)) {
        sendJson(res, 409, { error: "Descarga en progreso para este estudio" }); return;
      }

      startGet(cfg, body.studyUid, res);
      return;
    }

    // ── POST /cancel ───────────────────────────────────────────────────────
    if (req.method === "POST" && urlParts === "/cancel") {
      const body = await readBody(req);
      const studyUid = body.studyUid;

      if (!studyUid) {
        // Cancel all
        for (const [uid, proc] of activeDownloads.entries()) {
          try { proc.kill("SIGTERM"); } catch { /* ignore */ }
          activeDownloads.delete(uid);
        }
        sendJson(res, 200, { ok: true, message: "Todas las descargas canceladas" });
        return;
      }

      if (!validateUid(studyUid)) { sendJson(res, 400, { error: "studyUid inválido" }); return; }

      const proc = activeDownloads.get(studyUid);
      if (proc) {
        try { proc.kill("SIGTERM"); } catch { /* ignore */ }
        activeDownloads.delete(studyUid);
        log("info", "cancel", `Cancelled download for ${studyUid}`);
        sendJson(res, 200, { ok: true, message: "Descarga cancelada" });
      } else {
        sendJson(res, 404, { error: "No hay descarga activa para ese estudio" });
      }
      return;
    }

    // ── GET /cache ─────────────────────────────────────────────────────────
    if (req.method === "GET" && urlParts === "/cache") {
      sendJson(res, 200, { ok: true, entries: listCache() });
      return;
    }

    // ── DELETE /cache/:uid ─────────────────────────────────────────────────
    if (req.method === "DELETE" && urlParts.startsWith("/cache/")) {
      const rawUid = decodeURIComponent(urlParts.slice("/cache/".length));
      if (!validateUid(rawUid)) { sendJson(res, 400, { error: "studyUid inválido" }); return; }
      const result = deleteFromCache(rawUid);
      sendJson(res, result.ok ? 200 : 404, result);
      return;
    }

    // ── GET /cache/:uid/files (list files for opening in viewer) ───────────
    if (req.method === "GET" && urlParts.startsWith("/cache/") && urlParts.endsWith("/files")) {
      const rawUid = decodeURIComponent(urlParts.slice("/cache/".length, -"/files".length));
      if (!validateUid(rawUid)) { sendJson(res, 400, { error: "studyUid inválido" }); return; }
      const sanitized = rawUid.replace(/[^0-9.]/g, "_");
      const studyDir = path.join(CACHE_BASE, sanitized);
      if (!fs.existsSync(studyDir)) {
        sendJson(res, 404, { error: "Estudio no encontrado en caché" }); return;
      }
      const indexed = indexStudyDir(studyDir, rawUid);
      sendJson(res, 200, { ok: true, ...indexed });
      return;
    }

    // ── Serve DICOM file ───────────────────────────────────────────────────
    // GET /cache/:uid/file?path=<relative_path>
    if (req.method === "GET" && urlParts.startsWith("/cache/") && urlParts.includes("/file")) {
      const rawUid = decodeURIComponent(urlParts.split("/file")[0].slice("/cache/".length));
      if (!validateUid(rawUid)) { sendJson(res, 400, { error: "studyUid inválido" }); return; }

      const queryStr = url.split("?")[1] || "";
      const params = new URLSearchParams(queryStr);
      const relPath = params.get("path") || "";

      // Security: ensure path stays within cache directory
      const sanitizedUid = rawUid.replace(/[^0-9.]/g, "_");
      const studyDir = path.join(CACHE_BASE, sanitizedUid);
      const filePath = path.resolve(studyDir, relPath);

      if (!filePath.startsWith(CACHE_BASE)) {
        sendJson(res, 403, { error: "Acceso denegado" }); return;
      }

      if (!fs.existsSync(filePath)) {
        sendJson(res, 404, { error: "Archivo no encontrado" }); return;
      }

      const data = fs.readFileSync(filePath);
      res.writeHead(200, {
        "Content-Type": "application/dicom",
        "Content-Length": data.length,
        "Access-Control-Allow-Origin": "*",
      });
      res.end(data);
      return;
    }

    sendJson(res, 404, { error: "Endpoint no encontrado" });

  } catch (err) {
    log("error", "request_error", err.message);
    try {
      sendJson(res, 500, { error: err.message });
    } catch { /* ignore */ }
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractCfgOverride(body) {
  const override = {};
  if (body.pacsIp && validateIp(body.pacsIp)) override.pacsIp = body.pacsIp;
  if (body.pacsPort && validatePort(body.pacsPort)) override.pacsPort = String(body.pacsPort);
  if (body.calledAet && validateAet(body.calledAet)) override.calledAet = body.calledAet.toUpperCase();
  if (body.callingAet && validateAet(body.callingAet)) override.callingAet = body.callingAet.toUpperCase();
  return override;
}

// ─── Start ────────────────────────────────────────────────────────────────────

ensureLogDir();
ensureDir(CACHE_BASE);

server.listen(PORT, "127.0.0.1", () => {
  console.log("╔════════════════════════════════════════════╗");
  console.log("║   AFGMedView DCMTK Proxy                   ║");
  console.log("╚════════════════════════════════════════════╝");
  console.log(`[INFO] Proxy iniciado en http://127.0.0.1:${PORT}`);
  console.log(`[INFO] Caché DICOM: ${CACHE_BASE}`);
  console.log(`[INFO] Configuración: ${CONFIG_FILE}`);
  console.log(`[INFO] Logs: ${LOG_FILE}`);
  const cfg = getConfig();
  console.log(`[INFO] PACS configurado: ${cfg.pacsName} (${cfg.pacsIp}:${cfg.pacsPort})`);
  console.log(`[INFO] DCMTK bin: ${cfg.dcmtkBin}`);
  console.log("");
  console.log("[INFO] Esperando peticiones del visor AFGMedView...");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[ERROR] Puerto ${PORT} en uso. Cambie con DCMTK_PROXY_PORT.`);
  } else {
    console.error(`[ERROR] ${err.message}`);
  }
  process.exit(1);
});

process.on("SIGINT", () => {
  console.log("\n[INFO] Cerrando proxy...");
  for (const proc of activeDownloads.values()) {
    try { proc.kill(); } catch { /* ignore */ }
  }
  server.close(() => process.exit(0));
});
