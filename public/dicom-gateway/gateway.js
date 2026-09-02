#!/usr/bin/env node
/**
 * AFGMedView DICOM Gateway
 * ========================
 * Standalone Node.js process that:
 *  1. Listens on TCP port DICOM_PORT (default 4242) for C-ECHO and C-STORE
 *  2. Handles DICOM association negotiation
 *  3. Extracts DICOM metadata from received instances
 *  4. Saves DICOM files to /dicom-inbox/{StudyUID}/{SeriesUID}/
 *  5. Reports metadata to Convex via HTTP
 *
 * Requirements:
 *   node >= 18
 *   npm install dicom-parser dcmjs node-fetch@2 dotenv
 *
 * Environment variables (.env):
 *   DICOM_AE_TITLE=AFGMEDVIEW
 *   DICOM_PORT=4242
 *   CONVEX_SITE_URL=https://notable-husky-337.convex.site
 *   DICOM_INBOX_DIR=./dicom-inbox   (optional, default: ./dicom-inbox)
 */

"use strict";

// ─── Load env ────────────────────────────────────────────────────────────────

try {
  require("dotenv").config();
} catch {
  // dotenv optional — env vars may be set directly
}

const net = require("net");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ─── Configuration ────────────────────────────────────────────────────────────

const AE_TITLE     = process.env.DICOM_AE_TITLE   || "AFGMEDVIEW";
const PORT         = parseInt(process.env.DICOM_PORT || "4242", 10);
const CONVEX_URL   = process.env.CONVEX_SITE_URL   || "https://notable-husky-337.convex.site";
const INBOX_DIR    = process.env.DICOM_INBOX_DIR   || path.join(process.cwd(), "dicom-inbox");

// ─── Lazy-load optional deps ──────────────────────────────────────────────────

let dicomParser;
let fetch;

try {
  dicomParser = require("dicom-parser");
} catch {
  console.warn("[WARN] dicom-parser not installed. Run: npm install dicom-parser");
}

try {
  fetch = require("node-fetch");
} catch {
  // Node 18+ has built-in fetch
  fetch = globalThis.fetch;
}

// ─── DICOM constants ──────────────────────────────────────────────────────────

const PDU_TYPE = {
  A_ASSOCIATE_RQ: 0x01,
  A_ASSOCIATE_AC: 0x02,
  A_ASSOCIATE_RJ: 0x03,
  P_DATA_TF:      0x04,
  A_RELEASE_RQ:   0x05,
  A_RELEASE_RP:   0x06,
  A_ABORT:        0x07,
};

const PRESENTATION_CONTEXT_RESULT = {
  ACCEPTANCE: 0x00,
  USER_REJECTION: 0x01,
  NO_REASON: 0x02,
  ABSTRACT_SYNTAX_NOT_SUPPORTED: 0x03,
  TRANSFER_SYNTAXES_NOT_SUPPORTED: 0x04,
};

// Accepted SOP Classes (C-STORE)
const ACCEPTED_SOP_CLASSES = new Set([
  "1.2.840.10008.5.1.4.1.1.2",      // CT Image Storage
  "1.2.840.10008.5.1.4.1.1.4",      // MR Image Storage
  "1.2.840.10008.5.1.4.1.1.1",      // CR Image Storage
  "1.2.840.10008.5.1.4.1.1.1.1",    // Digital X-Ray (DX)
  "1.2.840.10008.5.1.4.1.1.6.1",    // US Image Storage
  "1.2.840.10008.5.1.4.1.1.12.1",   // XA Image Storage
  "1.2.840.10008.5.1.4.1.1.12.1.1", // Enhanced XA
  "1.2.840.10008.5.1.4.1.1.1.2",    // MG (Mammography)
  "1.2.840.10008.5.1.4.1.1.1.2.1",  // Digital Mammo
  "1.2.840.10008.5.1.4.1.1.7",      // SC (Secondary Capture)
  "1.2.840.10008.5.1.4.1.1.7.1",    // Multi-frame SC
  "1.2.840.10008.5.1.4.1.1.7.2",    // Multi-frame Grayscale Byte SC
  "1.2.840.10008.5.1.4.1.1.7.3",    // Multi-frame Grayscale Word SC
  "1.2.840.10008.5.1.4.1.1.7.4",    // Multi-frame True Color SC
  "1.2.840.10008.5.1.4.1.1.128",    // PET Image Storage
  "1.2.840.10008.5.1.4.1.1.20",     // NM Image Storage
  "1.2.840.10008.5.1.4.1.1.104.1",  // Encapsulated PDF
  "1.2.840.10008.5.1.4.1.1.11.1",   // GrayscaleSoftcopyPresentationState
  "1.2.840.10008.1.1",              // Verification SOP Class (C-ECHO)
]);

// Accepted Transfer Syntaxes
const ACCEPTED_TRANSFER_SYNTAXES = [
  "1.2.840.10008.1.2.1",  // Explicit VR Little Endian
  "1.2.840.10008.1.2",    // Implicit VR Little Endian
  "1.2.840.10008.1.2.2",  // Explicit VR Big Endian (legacy)
];

// DICOM Tags we extract
const TAG = {
  PatientName:       "00100010",
  PatientID:         "00100020",
  PatientBirthDate:  "00100030",
  PatientSex:        "00100040",
  StudyInstanceUID:  "0020000D",
  StudyDate:         "00080020",
  StudyTime:         "00080030",
  StudyDescription:  "00081030",
  AccessionNumber:   "00080050",
  Modality:          "00080060",
  SeriesInstanceUID: "0020000E",
  SeriesNumber:      "00200011",
  SeriesDescription: "0008103E",
  SOPInstanceUID:    "00080018",
  SOPClassUID:       "00080016",
  InstanceNumber:    "00200013",
  Rows:              "00280010",
  Columns:           "00280011",
};

// ─── Stats ────────────────────────────────────────────────────────────────────

const stats = {
  totalInstances: 0,
  totalStudies: 0,
  totalErrors: 0,
  startedAt: new Date().toISOString(),
};

// Track open studies for grouping (timeout-based completion)
const openStudies = new Map(); // studyUID → { timer, instanceCount, seriesCount }
const STUDY_COMPLETE_TIMEOUT_MS = 30_000; // 30s of inactivity = study complete

// ─── Logging ──────────────────────────────────────────────────────────────────

function log(level, event, message, extra = {}) {
  const ts = new Date().toISOString();
  const tag = `[${level.toUpperCase()}][${event}]`;
  // Don't log patient names at INFO level in production
  const safeMsg = level === "info"
    ? message.replace(/([A-Z][a-z]+\^[A-Z^]+)/g, "[PATIENT]")
    : message;
  console.log(`${ts} ${tag} ${safeMsg}`);

  // Report errors to Convex asynchronously
  if (level === "error") {
    stats.totalErrors++;
    postToConvex("/dicom/error", {
      event,
      message,
      ...extra,
    }).catch(() => {/* ignore */});
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function postToConvex(path, body) {
  const url = CONVEX_URL.replace(/\/$/, "") + path;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      log("warn", "convex_post_failed", `HTTP ${res.status} for ${path}`);
    }
    return res;
  } catch (err) {
    log("error", "convex_unreachable", `Cannot reach Convex: ${err.message}`, { event: "convex_unreachable", message: err.message });
  }
}

// ─── Heartbeat ───────────────────────────────────────────────────────────────

function getLocalIp() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "127.0.0.1";
}

function startHeartbeat() {
  const serverIp = getLocalIp();
  async function beat() {
    try {
      await postToConvex("/dicom/heartbeat", {
        aeTitle: AE_TITLE,
        port: PORT,
        serverIp,
      });
    } catch {/* ignore */}
  }
  beat();
  setInterval(beat, 60_000); // every 60s
}

// ─── DICOM tag extraction ─────────────────────────────────────────────────────

function extractTag(dataSet, tagStr) {
  if (!dataSet) return undefined;
  const el = dataSet.elements[tagStr];
  if (!el) return undefined;
  try {
    return dataSet.string(tagStr) || undefined;
  } catch {
    return undefined;
  }
}

function extractTagInt(dataSet, tagStr) {
  const val = extractTag(dataSet, tagStr);
  if (val === undefined) return undefined;
  const n = parseInt(val, 10);
  return isNaN(n) ? undefined : n;
}

function parseMetadata(buffer) {
  if (!dicomParser) {
    throw new Error("dicom-parser not installed");
  }
  const uint8 = new Uint8Array(buffer);
  const dataSet = dicomParser.parseDicom(uint8, { untilTag: "00281000" });

  return {
    patientName:       extractTag(dataSet, TAG.PatientName)      || "UNKNOWN",
    patientId:         extractTag(dataSet, TAG.PatientID)        || "UNKNOWN",
    patientBirthDate:  extractTag(dataSet, TAG.PatientBirthDate),
    patientSex:        extractTag(dataSet, TAG.PatientSex),
    studyInstanceUid:  extractTag(dataSet, TAG.StudyInstanceUID)  || "",
    studyDate:         extractTag(dataSet, TAG.StudyDate),
    studyTime:         extractTag(dataSet, TAG.StudyTime),
    studyDescription:  extractTag(dataSet, TAG.StudyDescription),
    accessionNumber:   extractTag(dataSet, TAG.AccessionNumber),
    modality:          extractTag(dataSet, TAG.Modality)          || "OT",
    seriesInstanceUid: extractTag(dataSet, TAG.SeriesInstanceUID) || "",
    seriesNumber:      extractTag(dataSet, TAG.SeriesNumber),
    seriesDescription: extractTag(dataSet, TAG.SeriesDescription),
    sopInstanceUid:    extractTag(dataSet, TAG.SOPInstanceUID)    || "",
    sopClassUid:       extractTag(dataSet, TAG.SOPClassUID),
    instanceNumber:    extractTag(dataSet, TAG.InstanceNumber),
    rows:              extractTagInt(dataSet, TAG.Rows),
    columns:           extractTagInt(dataSet, TAG.Columns),
  };
}

// ─── File storage ─────────────────────────────────────────────────────────────

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function saveInstance(studyUid, seriesUid, sopUid, buffer) {
  const studyDir  = path.join(INBOX_DIR, sanitizeUid(studyUid), sanitizeUid(seriesUid));
  ensureDir(studyDir);
  const filePath  = path.join(studyDir, `${sanitizeUid(sopUid)}.dcm`);
  fs.writeFileSync(filePath, Buffer.from(buffer));
  return filePath;
}

function sanitizeUid(uid) {
  return (uid || "unknown").replace(/[^0-9.]/g, "_");
}

// ─── Study completion tracker ─────────────────────────────────────────────────

function touchStudy(studyUid, sourceAeTitle, sourceIp) {
  if (openStudies.has(studyUid)) {
    const entry = openStudies.get(studyUid);
    clearTimeout(entry.timer);
    entry.instanceCount++;
    entry.timer = setTimeout(() => finalizeStudy(studyUid), STUDY_COMPLETE_TIMEOUT_MS);
  } else {
    const entry = {
      instanceCount: 1,
      seriesUids: new Set(),
      sourceAeTitle,
      sourceIp,
      timer: setTimeout(() => finalizeStudy(studyUid), STUDY_COMPLETE_TIMEOUT_MS),
    };
    openStudies.set(studyUid, entry);
  }
}

function touchSeries(studyUid, seriesUid) {
  const entry = openStudies.get(studyUid);
  if (entry) entry.seriesUids.add(seriesUid);
}

async function finalizeStudy(studyUid) {
  const entry = openStudies.get(studyUid);
  if (!entry) return;
  openStudies.delete(studyUid);

  log("info", "study_ready", `Finalizing study ${studyUid} — ${entry.instanceCount} instances`);

  await postToConvex("/dicom/study-ready", {
    studyInstanceUid: studyUid,
    finalInstanceCount: entry.instanceCount,
    finalSeriesCount: entry.seriesUids.size,
  });

  stats.totalStudies++;
  log("info", "convex_study_ready", `Study ${studyUid} marked READY in Convex`);
}

// ─── PDU Builders ────────────────────────────────────────────────────────────

/**
 * Build A-ASSOCIATE-AC PDU in response to a RQ.
 * Accepts all valid presentation contexts.
 */
function buildAssociateAC(rqPdu, calledAeTitle) {
  // Parse RQ to find presentation contexts
  const contexts = parseAssociateRQ(rqPdu);

  const parts = [];

  // Protocol version
  parts.push(Buffer.from([0x00, 0x01])); // protocol version = 1

  // Reserved
  parts.push(Buffer.alloc(2));

  // Called AE title (16 bytes)
  const called = Buffer.alloc(16, 0x20);
  Buffer.from(calledAeTitle.substring(0, 16)).copy(called);
  parts.push(called);

  // Calling AE title (16 bytes)
  const calling = Buffer.alloc(16, 0x20);
  if (contexts.callingAeTitle) {
    Buffer.from(contexts.callingAeTitle.substring(0, 16)).copy(calling);
  }
  parts.push(calling);

  // Reserved 32 bytes
  parts.push(Buffer.alloc(32));

  // Application Context Item (type 0x10)
  const appContext = buildItem(0x10, Buffer.from("1.2.840.10008.3.1.1.1"));
  parts.push(appContext);

  // Presentation Context Items (type 0x21)
  for (const ctx of contexts.presentationContexts) {
    const accepted = ACCEPTED_SOP_CLASSES.has(ctx.abstractSyntax);
    const result = accepted
      ? PRESENTATION_CONTEXT_RESULT.ACCEPTANCE
      : PRESENTATION_CONTEXT_RESULT.ABSTRACT_SYNTAX_NOT_SUPPORTED;

    const tsUid = accepted ? ACCEPTED_TRANSFER_SYNTAXES[0] : ACCEPTED_TRANSFER_SYNTAXES[0];
    const tsItem = buildItem(0x40, Buffer.from(tsUid));

    const pcBody = Buffer.concat([
      Buffer.from([ctx.id, 0x00, result, 0x00]),
      tsItem,
    ]);
    parts.push(buildItem(0x21, pcBody));
  }

  // User Information Item (type 0x50)
  // Max PDU length sub-item
  const maxPduSub = Buffer.concat([
    Buffer.from([0x51, 0x00, 0x00, 0x04]),
    int32BE(65536),
  ]);
  parts.push(buildItem(0x50, maxPduSub));

  const payload = Buffer.concat(parts);
  return buildPdu(PDU_TYPE.A_ASSOCIATE_AC, payload);
}

function buildAssociateRJ(result, source, reason) {
  const payload = Buffer.from([0x00, result, source, reason]);
  return buildPdu(PDU_TYPE.A_ASSOCIATE_RJ, payload);
}

function buildReleaseRP() {
  return buildPdu(PDU_TYPE.A_RELEASE_RP, Buffer.alloc(4));
}

function buildCStoreResponse(messageId, sopClassUid, sopInstanceUid, status) {
  // Minimal C-STORE-RSP command dataset
  const cmdItems = [];
  const addTag = (group, element, vr, value) => {
    const val = vr === "UI" ? Buffer.from(value + "\0".repeat(value.length % 2)) : value;
    const len = val.length;
    cmdItems.push(Buffer.from([
      group & 0xFF, (group >> 8) & 0xFF,
      element & 0xFF, (element >> 8) & 0xFF,
    ]));
    cmdItems.push(Buffer.from(vr));
    cmdItems.push(Buffer.from([0x00, 0x00])); // reserved
    cmdItems.push(int32LE(len));
    cmdItems.push(val);
  };

  addTag(0x0000, 0x0002, "UI", sopClassUid);
  addTag(0x0000, 0x0100, "US", int16LE(0x8001)); // C-STORE-RSP
  addTag(0x0000, 0x0110, "US", int16LE(messageId));
  addTag(0x0000, 0x0900, "US", int16LE(status));
  addTag(0x0000, 0x1000, "UI", sopInstanceUid);

  const cmdData = Buffer.concat(cmdItems);

  // Command group length (tag 0000,0000)
  const groupLen = Buffer.from([
    0x00, 0x00, 0x00, 0x00,
    "U".charCodeAt(0), "L".charCodeAt(0),
    0x00, 0x00,
    0x04, 0x00, 0x00, 0x00,
  ]);
  const lenBuf = int32LE(cmdData.length);
  const cmd = Buffer.concat([groupLen, lenBuf, cmdData]);

  // P-DATA-TF
  const pcId = 0x01; // first presentation context
  const pdvHeader = Buffer.from([0x00, 0x00, 0x00, 0x00, pcId, 0x03]); // last fragment, command
  const pdvLen = int32BE(cmd.length + 2); // +2 for pcId + flags
  pdvLen.copy(pdvHeader, 0);

  const pdvItem = Buffer.concat([pdvHeader, cmd]);
  const pduLen = int32BE(pdvItem.length);
  const pduHeader = Buffer.from([PDU_TYPE.P_DATA_TF, 0x00]);
  return Buffer.concat([pduHeader, pduLen, pdvItem]);
}

// ─── PDU Helpers ──────────────────────────────────────────────────────────────

function buildPdu(type, payload) {
  const header = Buffer.from([type, 0x00]);
  const len = int32BE(payload.length);
  return Buffer.concat([header, len, payload]);
}

function buildItem(type, data) {
  const header = Buffer.from([type, 0x00]);
  const len = int16BE(data.length);
  return Buffer.concat([header, len, data]);
}

function int32BE(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function int32LE(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

function int16BE(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n, 0);
  return b;
}

function int16LE(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}

// ─── RQ Parser ───────────────────────────────────────────────────────────────

function parseAssociateRQ(data) {
  const result = {
    calledAeTitle: "",
    callingAeTitle: "",
    presentationContexts: [],
  };

  if (data.length < 76) return result;

  // Called AE (bytes 10-25) and Calling AE (bytes 26-41) after PDU header (6 bytes)
  result.calledAeTitle  = data.slice(10, 26).toString("ascii").trim();
  result.callingAeTitle = data.slice(26, 42).toString("ascii").trim();

  // Parse variable items starting at offset 74 (after 32 reserved bytes)
  let offset = 74;
  while (offset < data.length - 4) {
    const itemType = data[offset];
    offset += 2; // type + reserved
    const itemLen = data.readUInt16BE(offset);
    offset += 2;
    const itemEnd = offset + itemLen;

    if (itemType === 0x20) {
      // Presentation Context RQ
      const pcId = data[offset];
      // offset+1 reserved, offset+2 reserved, offset+3 reserved
      let pcOffset = offset + 4;

      let abstractSyntax = "";
      const transferSyntaxes = [];

      while (pcOffset < itemEnd) {
        const subType = data[pcOffset];
        pcOffset += 2;
        const subLen = data.readUInt16BE(pcOffset);
        pcOffset += 2;
        const uid = data.slice(pcOffset, pcOffset + subLen).toString("ascii").replace(/\0/g, "");
        pcOffset += subLen;

        if (subType === 0x30) abstractSyntax = uid;
        else if (subType === 0x40) transferSyntaxes.push(uid);
      }

      result.presentationContexts.push({ id: pcId, abstractSyntax, transferSyntaxes });
    }

    offset = itemEnd;
  }

  return result;
}

// ─── Connection handler ───────────────────────────────────────────────────────

function handleConnection(socket) {
  const remoteIp = socket.remoteAddress?.replace(/^::ffff:/, "") ?? "unknown";
  log("info", "dicom_connection_received", `Connection from ${remoteIp}`);

  let buffer = Buffer.alloc(0);
  let associatedSopClassUid = ""; // SOP class for current association
  let callingAeTitle = "";
  let currentCStoreData = null;
  let currentMessageId = 1;
  let currentSopInstanceUid = "";
  let currentSopClassUid = "";

  socket.on("data", (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    processBuffer();
  });

  socket.on("error", (err) => {
    log("error", "socket_error", `Socket error from ${remoteIp}: ${err.message}`);
  });

  socket.on("close", () => {
    log("info", "connection_closed", `Connection from ${remoteIp} closed`);
  });

  function processBuffer() {
    // PDU minimum length is 6 bytes (type + reserved + 4-byte length)
    while (buffer.length >= 6) {
      const pduType = buffer[0];
      const pduLen = buffer.readUInt32BE(2);
      const totalLen = 6 + pduLen;

      if (buffer.length < totalLen) break; // wait for more data

      const pduData = buffer.slice(0, totalLen);
      buffer = buffer.slice(totalLen);

      handlePdu(pduType, pduData);
    }
  }

  function handlePdu(pduType, data) {
    switch (pduType) {
      case PDU_TYPE.A_ASSOCIATE_RQ:
        handleAssociateRQ(data);
        break;
      case PDU_TYPE.P_DATA_TF:
        handlePDataTF(data);
        break;
      case PDU_TYPE.A_RELEASE_RQ:
        log("info", "a_release_rq", `Release request from ${remoteIp}`);
        socket.write(buildReleaseRP());
        socket.end();
        break;
      case PDU_TYPE.A_ABORT:
        log("info", "a_abort", `Abort from ${remoteIp}`);
        socket.destroy();
        break;
      default:
        log("warn", "unknown_pdu", `Unknown PDU type 0x${pduType.toString(16)} from ${remoteIp}`);
    }
  }

  function handleAssociateRQ(data) {
    const rq = parseAssociateRQ(data);
    callingAeTitle = rq.callingAeTitle;

    log("info", "a_associate_rq", `A-ASSOCIATE-RQ from AE: ${callingAeTitle} @ ${remoteIp}`);

    // Check if at least one presentation context is acceptable
    const hasEcho = rq.presentationContexts.some(
      pc => pc.abstractSyntax === "1.2.840.10008.1.1"
    );
    const hasStore = rq.presentationContexts.some(
      pc => ACCEPTED_SOP_CLASSES.has(pc.abstractSyntax)
    );

    if (!hasEcho && !hasStore) {
      log("warn", "a_associate_rj", `Rejecting association — no supported SOP classes`);
      socket.write(buildAssociateRJ(0x01, 0x01, 0x01));
      return;
    }

    // Set the primary SOP class for this association
    if (hasStore) {
      const storeCtx = rq.presentationContexts.find(
        pc => ACCEPTED_SOP_CLASSES.has(pc.abstractSyntax) && pc.abstractSyntax !== "1.2.840.10008.1.1"
      );
      if (storeCtx) associatedSopClassUid = storeCtx.abstractSyntax;
    }

    const ac = buildAssociateAC(data, AE_TITLE);
    socket.write(ac);
    log("info", "a_associate_ac", `A-ASSOCIATE-AC sent to ${callingAeTitle}`);
  }

  function handlePDataTF(data) {
    // Parse PDV items
    let offset = 6; // skip PDU header
    while (offset < data.length) {
      const pdvLen = data.readUInt32BE(offset);
      offset += 4;
      const pcId    = data[offset];
      const flags   = data[offset + 1];
      const pdvData = data.slice(offset + 2, offset + pdvLen);
      offset += pdvLen;

      const isCommand  = (flags & 0x01) !== 0;
      const isLastFrag = (flags & 0x02) !== 0;

      if (isCommand) {
        // Command dataset — extract C-ECHO or C-STORE info
        parseCommand(pdvData, pcId);
      } else {
        // Data dataset (pixel data etc.)
        if (currentCStoreData === null) {
          currentCStoreData = [pdvData];
        } else {
          currentCStoreData.push(pdvData);
        }

        if (isLastFrag) {
          const dicomBuffer = Buffer.concat(currentCStoreData);
          currentCStoreData = null;
          processCStoreData(dicomBuffer);
        }
      }
    }
  }

  function parseCommand(data, pcId) {
    // Minimal command parsing — read CommandField (0000,0100)
    // Very simplified: look for the command field tag bytes
    let cmdField = 0;
    let msgId    = 1;
    let sopClass = "";
    let sopInst  = "";

    let offset = 0;
    while (offset + 8 <= data.length) {
      const group   = data.readUInt16LE(offset);
      const element = data.readUInt16LE(offset + 2);
      offset += 4;

      // Detect VR vs implicit
      let vr = "";
      let len = 0;
      const nextTwo = data.slice(offset, offset + 2).toString("ascii");
      if (/^[A-Z]{2}$/.test(nextTwo)) {
        vr = nextTwo;
        offset += 2;
        if (["OB", "OW", "SQ", "UN"].includes(vr)) {
          offset += 2; // reserved
          len = data.readUInt32LE(offset);
          offset += 4;
        } else {
          len = data.readUInt16LE(offset);
          offset += 2;
        }
      } else {
        // Implicit VR
        len = data.readUInt32LE(offset);
        offset += 4;
      }

      if (len > data.length - offset) break;
      const value = data.slice(offset, offset + len);
      offset += len;

      if (group === 0x0000 && element === 0x0100) {
        cmdField = value.readUInt16LE(0);
      } else if (group === 0x0000 && element === 0x0110) {
        msgId = value.readUInt16LE(0);
      } else if (group === 0x0000 && element === 0x0002) {
        sopClass = value.toString("ascii").replace(/\0/g, "").trim();
      } else if (group === 0x0000 && element === 0x1000) {
        sopInst = value.toString("ascii").replace(/\0/g, "").trim();
      }
    }

    currentMessageId = msgId;
    if (sopClass) currentSopClassUid = sopClass;
    if (sopInst)  currentSopInstanceUid = sopInst;

    const C_ECHO_RQ  = 0x0030;
    const C_STORE_RQ = 0x0001;

    if (cmdField === C_ECHO_RQ) {
      handleCEcho(msgId, sopClass);
    }
    // C_STORE_RQ: data follows in subsequent PDV, handled in processCStoreData
  }

  function handleCEcho(msgId, sopClass) {
    log("info", "c_echo_received", `C-ECHO from ${callingAeTitle} @ ${remoteIp}`);

    // Build C-ECHO-RSP
    const echoRsp = buildCStoreResponse(msgId, sopClass || "1.2.840.10008.1.1", "", 0x0000);
    socket.write(echoRsp);

    log("info", "c_echo_success", `C-ECHO SUCCESS replied to ${callingAeTitle}`);

    // Report to Convex
    postToConvex("/dicom/echo", {
      sourceAeTitle: callingAeTitle,
      sourceIp: remoteIp,
      success: true,
    }).catch(() => {/* ignore */});
  }

  async function processCStoreData(buffer) {
    try {
      log("info", "c_store_received", `C-STORE data received (${buffer.length} bytes) from ${callingAeTitle}`);

      // Parse DICOM metadata
      const meta = parseMetadata(buffer);

      if (!meta.studyInstanceUid || !meta.sopInstanceUid) {
        throw new Error("Missing required DICOM UIDs in instance");
      }

      // Save file
      const filePath = saveInstance(
        meta.studyInstanceUid,
        meta.seriesInstanceUid,
        meta.sopInstanceUid,
        buffer,
      );

      log("info", "instance_stored", `Instance stored: ${meta.sopInstanceUid}`);

      // Send C-STORE-RSP SUCCESS (status 0x0000)
      const rsp = buildCStoreResponse(
        currentMessageId,
        currentSopClassUid || meta.sopClassUid || associatedSopClassUid || "1.2.840.10008.5.1.4.1.1.7",
        meta.sopInstanceUid,
        0x0000,
      );
      socket.write(rsp);

      // Report instance to Convex
      await postToConvex("/dicom/instance", {
        ...meta,
        filePath,
        sourceAeTitle: callingAeTitle,
        sourceIp: remoteIp,
      });

      log("info", "convex_metadata_uploaded", `Metadata sent to Convex for ${meta.sopInstanceUid}`);

      stats.totalInstances++;

      // Track study completion
      touchStudy(meta.studyInstanceUid, callingAeTitle, remoteIp);
      touchSeries(meta.studyInstanceUid, meta.seriesInstanceUid);

    } catch (err) {
      stats.totalErrors++;
      log("error", "c_store_failed", `C-STORE processing error: ${err.message}`);

      // Send C-STORE-RSP with FAILURE status
      const rsp = buildCStoreResponse(
        currentMessageId,
        currentSopClassUid || associatedSopClassUid || "1.2.840.10008.5.1.4.1.1.7",
        currentSopInstanceUid || "",
        0xA700, // Out of resources
      );
      socket.write(rsp);
    }
  }
}

// ─── Main server ──────────────────────────────────────────────────────────────

function main() {
  console.log("╔════════════════════════════════════════╗");
  console.log("║   AFGMedView DICOM Gateway             ║");
  console.log("╚════════════════════════════════════════╝");

  // Validate deps
  if (!dicomParser) {
    console.error("[ERROR] dicom-parser is required. Run: npm install dicom-parser");
    process.exit(1);
  }

  // Ensure inbox directory exists
  ensureDir(INBOX_DIR);
  console.log(`[INFO] DICOM inbox: ${INBOX_DIR}`);

  const server = net.createServer(handleConnection);

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[ERROR] Port ${PORT} is already in use.`);
      console.error(`        Make sure no other process is using port ${PORT}.`);
      console.error(`        You can change the port with DICOM_PORT env variable.`);
    } else if (err.code === "EACCES") {
      console.error(`[ERROR] Permission denied to bind port ${PORT}.`);
      console.error(`        Ports below 1024 require root privileges.`);
      console.error(`        Use DICOM_PORT=4242 or another port >= 1024.`);
    } else {
      console.error(`[ERROR] Server error: ${err.message}`);
    }
    process.exit(1);
  });

  server.listen(PORT, "0.0.0.0", () => {
    const ip = getLocalIp();
    console.log(`[INFO] DICOM Gateway started`);
    console.log(`[INFO] AE Title : ${AE_TITLE}`);
    console.log(`[INFO] Port     : ${PORT}`);
    console.log(`[INFO] Local IP : ${ip}`);
    console.log(`[INFO] Convex   : ${CONVEX_URL}`);
    console.log("");
    console.log("[INFO] Configure RadiAnt with:");
    console.log(`[INFO]   Description : AFGMedView`);
    console.log(`[INFO]   AE Title    : ${AE_TITLE}`);
    console.log(`[INFO]   IP Address  : ${ip}`);
    console.log(`[INFO]   Port        : ${PORT}`);
    console.log("");
    console.log("[INFO] Waiting for DICOM connections...");

    startHeartbeat();
  });

  process.on("SIGINT", () => {
    console.log("\n[INFO] Shutting down DICOM Gateway...");
    // Finalize any open studies
    for (const uid of openStudies.keys()) {
      void finalizeStudy(uid);
    }
    server.close(() => process.exit(0));
  });
}

main();
