/**
 * Backend — MEDVIEW AI REPORT
 * Queries, mutations y la action de generación IA.
 *
 * Seguridad: cada función verifica que el usuario tiene licencia PRO activa antes de operar.
 */
import { query, mutation, action, internalMutation } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v, ConvexError } from "convex/values";
import { api, internal } from "./_generated/api";
import type { QueryCtx, MutationCtx } from "./_generated/server";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function requireProUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ message: "No autenticado", code: "UNAUTHENTICATED" });

  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ message: "Usuario no encontrado", code: "NOT_FOUND" });

  // Verificar licencia PRO activa
  const license = await ctx.db
    .query("licenses")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .first();

  const isPro = license &&
    license.status === "active" &&
    (license.planType === "pro" || license.planType === "premium");

  if (!isPro) {
    throw new ConvexError({ message: "Esta función requiere MEDVIEW PRO", code: "FORBIDDEN" });
  }

  return { user, license };
}

function generateReportCode(): string {
  const now = new Date();
  const y = now.getUTCFullYear().toString().slice(-2);
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `RPT-${y}${m}${d}-${rand}`;
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export const getMyReports = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    status: v.optional(v.union(v.literal("draft"), v.literal("final"), v.literal("all"))),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { page: [] as Array<{
      _id: string; title: string; patientName: string;
      modality?: string; studyDate?: string; reportCode: string;
      status: "draft" | "final"; createdAt: string; updatedAt: string;
    }>, isDone: true, continueCursor: "" };

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return { page: [] as Array<{
      _id: string; title: string; patientName: string;
      modality?: string; studyDate?: string; reportCode: string;
      status: "draft" | "final"; createdAt: string; updatedAt: string;
    }>, isDone: true, continueCursor: "" };

    const q = ctx.db.query("aiReports").withIndex("by_user", (q2) => q2.eq("userId", user._id));

    const result = await q.order("desc").paginate(args.paginationOpts);
    let page = result.page;

    // Filtrado en memoria (texto libre o estado)
    if (args.search && args.search.trim() !== "") {
      const lower = args.search.toLowerCase();
      page = page.filter(r =>
        r.title.toLowerCase().includes(lower) ||
        r.patientName.toLowerCase().includes(lower) ||
        r.reportCode.toLowerCase().includes(lower) ||
        (r.modality ?? "").toLowerCase().includes(lower)
      );
    }
    if (args.status && args.status !== "all") {
      page = page.filter(r => r.status === args.status);
    }

    return {
      ...result,
      page: page.map(r => ({
        _id: r._id,
        title: r.title,
        patientName: r.patientName,
        modality: r.modality,
        studyDate: r.studyDate,
        reportCode: r.reportCode,
        status: r.status,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    };
  },
});

export const getReport = query({
  args: { reportId: v.id("aiReports") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;

    const report = await ctx.db.get(args.reportId);
    if (!report || report.userId !== user._id) return null;
    return report;
  },
});

export const getMyTemplates = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return [];

    return ctx.db.query("aiReportTemplates").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
  },
});

export const getDoctorProfile = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;

    return ctx.db.query("doctorProfile").withIndex("by_user", (q) => q.eq("userId", user._id)).first();
  },
});

// ─── Mutations ────────────────────────────────────────────────────────────────

export const createReport = mutation({
  args: {
    title: v.string(),
    studyInstanceUid: v.optional(v.string()),
    patientName: v.string(),
    patientId: v.optional(v.string()),
    patientAge: v.optional(v.string()),
    patientSex: v.optional(v.string()),
    studyDate: v.optional(v.string()),
    modality: v.optional(v.string()),
    anatomicRegion: v.optional(v.string()),
    clinicalHistory: v.optional(v.string()),
    indication: v.string(),
    technique: v.string(),
    findings: v.string(),
    impression: v.string(),
    recommendations: v.optional(v.string()),
    templateId: v.optional(v.id("aiReportTemplates")),
  },
  handler: async (ctx, args) => {
    const { user } = await requireProUser(ctx);
    const now = new Date().toISOString();
    return ctx.db.insert("aiReports", {
      userId: user._id,
      ...args,
      reportCode: generateReportCode(),
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateReport = mutation({
  args: {
    reportId: v.id("aiReports"),
    title: v.optional(v.string()),
    indication: v.optional(v.string()),
    technique: v.optional(v.string()),
    findings: v.optional(v.string()),
    impression: v.optional(v.string()),
    recommendations: v.optional(v.string()),
    anatomicRegion: v.optional(v.string()),
    clinicalHistory: v.optional(v.string()),
    patientAge: v.optional(v.string()),
    patientSex: v.optional(v.string()),
    status: v.optional(v.union(v.literal("draft"), v.literal("final"))),
  },
  handler: async (ctx, args) => {
    const { user } = await requireProUser(ctx);
    const report = await ctx.db.get(args.reportId);
    if (!report || report.userId !== user._id) {
      throw new ConvexError({ message: "Informe no encontrado", code: "NOT_FOUND" });
    }
    const { reportId, ...fields } = args;
    await ctx.db.patch(reportId, { ...fields, updatedAt: new Date().toISOString() });
  },
});

export const deleteReport = mutation({
  args: { reportId: v.id("aiReports") },
  handler: async (ctx, args) => {
    const { user } = await requireProUser(ctx);
    const report = await ctx.db.get(args.reportId);
    if (!report || report.userId !== user._id) {
      throw new ConvexError({ message: "Informe no encontrado", code: "NOT_FOUND" });
    }
    await ctx.db.delete(args.reportId);
  },
});

export const duplicateReport = mutation({
  args: { reportId: v.id("aiReports") },
  handler: async (ctx, args) => {
    const { user } = await requireProUser(ctx);
    const report = await ctx.db.get(args.reportId);
    if (!report || report.userId !== user._id) {
      throw new ConvexError({ message: "Informe no encontrado", code: "NOT_FOUND" });
    }
    const now = new Date().toISOString();
    return ctx.db.insert("aiReports", {
      userId: user._id,
      title: `${report.title} (copia)`,
      studyInstanceUid: report.studyInstanceUid,
      patientName: report.patientName,
      patientId: report.patientId,
      patientAge: report.patientAge,
      patientSex: report.patientSex,
      studyDate: report.studyDate,
      modality: report.modality,
      anatomicRegion: report.anatomicRegion,
      clinicalHistory: report.clinicalHistory,
      indication: report.indication,
      technique: report.technique,
      findings: report.findings,
      impression: report.impression,
      recommendations: report.recommendations,
      reportCode: generateReportCode(),
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const convertReportToTemplate = mutation({
  args: { reportId: v.id("aiReports") },
  handler: async (ctx, args) => {
    const { user } = await requireProUser(ctx);
    const report = await ctx.db.get(args.reportId);
    if (!report || report.userId !== user._id) {
      throw new ConvexError({ message: "Informe no encontrado", code: "NOT_FOUND" });
    }
    const now = new Date().toISOString();
    return ctx.db.insert("aiReportTemplates", {
      userId: user._id,
      name: report.title,
      modality: report.modality,
      indication: report.indication,
      technique: report.technique,
      findings: report.findings,
      impression: report.impression,
      recommendations: report.recommendations,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const saveDoctorProfile = mutation({
  args: {
    doctorName: v.string(),
    specialty: v.optional(v.string()),
    registration: v.optional(v.string()),
    medicalCenter: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    country: v.optional(v.string()),
    reportFooter: v.optional(v.string()),
    logoStorageId: v.optional(v.string()),
    signatureStorageId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireProUser(ctx);
    const existing = await ctx.db
      .query("doctorProfile")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, args);
    } else {
      await ctx.db.insert("doctorProfile", { userId: user._id, ...args });
    }
  },
});

export const generateUploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireProUser(ctx);
    return ctx.storage.generateUploadUrl();
  },
});

export const getFileUrl = query({
  args: { storageId: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    return ctx.storage.getUrl(args.storageId);
  },
});

export const saveTemplate = mutation({
  args: {
    name: v.string(),
    modality: v.optional(v.string()),
    indication: v.optional(v.string()),
    technique: v.optional(v.string()),
    findings: v.optional(v.string()),
    impression: v.optional(v.string()),
    recommendations: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireProUser(ctx);
    const now = new Date().toISOString();
    return ctx.db.insert("aiReportTemplates", {
      userId: user._id,
      ...args,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateTemplate = mutation({
  args: {
    templateId: v.id("aiReportTemplates"),
    name: v.optional(v.string()),
    modality: v.optional(v.string()),
    indication: v.optional(v.string()),
    technique: v.optional(v.string()),
    findings: v.optional(v.string()),
    impression: v.optional(v.string()),
    recommendations: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user } = await requireProUser(ctx);
    const tmpl = await ctx.db.get(args.templateId);
    if (!tmpl || tmpl.userId !== user._id) {
      throw new ConvexError({ message: "Plantilla no encontrada", code: "NOT_FOUND" });
    }
    const { templateId, ...fields } = args;
    await ctx.db.patch(templateId, { ...fields, updatedAt: new Date().toISOString() });
  },
});

export const duplicateTemplate = mutation({
  args: { templateId: v.id("aiReportTemplates") },
  handler: async (ctx, args) => {
    const { user } = await requireProUser(ctx);
    const tmpl = await ctx.db.get(args.templateId);
    if (!tmpl || tmpl.userId !== user._id) {
      throw new ConvexError({ message: "Plantilla no encontrada", code: "NOT_FOUND" });
    }
    const now = new Date().toISOString();
    return ctx.db.insert("aiReportTemplates", {
      userId: user._id,
      name: `${tmpl.name} (copia)`,
      modality: tmpl.modality,
      indication: tmpl.indication,
      technique: tmpl.technique,
      findings: tmpl.findings,
      impression: tmpl.impression,
      recommendations: tmpl.recommendations,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const deleteTemplate = mutation({
  args: { templateId: v.id("aiReportTemplates") },
  handler: async (ctx, args) => {
    const { user } = await requireProUser(ctx);
    const tmpl = await ctx.db.get(args.templateId);
    if (!tmpl || tmpl.userId !== user._id) {
      throw new ConvexError({ message: "Plantilla no encontrada", code: "NOT_FOUND" });
    }
    await ctx.db.delete(args.templateId);
  },
});

// ─── Internal mutation para guardar el borrador generado por IA ────────────────

export const _saveAIDraft = internalMutation({
  args: {
    reportId: v.id("aiReports"),
    findings: v.string(),
    impression: v.string(),
    technique: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.reportId, {
      findings: args.findings,
      impression: args.impression,
      technique: args.technique,
      updatedAt: new Date().toISOString(),
    });
  },
});

// ─── Helper: construir request OpenAI-compatible ─────────────────────────────

function buildOpenAIRequest(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: string; content: string }>,
  temperature: number,
  maxTokens: number,
  extraHeaders?: Record<string, string>
): { url: string; headers: Record<string, string>; body: string } {
  return {
    url: `${baseUrl}/chat/completions`,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
  };
}

function parseAIDraftContent(
  content: string,
  modality: string
): { technique: string; findings: string; impression: string } {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? jsonMatch[0] : content;
    const parsed = JSON.parse(jsonStr) as { technique?: string; findings?: string; impression?: string };
    if (parsed.findings && parsed.impression) return {
      technique: parsed.technique ?? `Estudio de ${modality} realizado según protocolo estándar.`,
      findings: parsed.findings,
      impression: parsed.impression,
    };
  } catch {
    // fall through to fallback
  }
  return {
    technique: `Estudio de ${modality} realizado según protocolo estándar para la región indicada.`,
    findings: content || "No se pudo generar contenido. Por favor escriba los hallazgos manualmente.",
    impression: "Conclusión pendiente de revisión por el médico.",
  };
}

// ─── Action: generación IA del borrador ──────────────────────────────────────

export const generateDraft = action({
  args: {
    reportId: v.id("aiReports"),
    patientName: v.string(),
    modality: v.string(),
    indication: v.string(),
    studyDate: v.optional(v.string()),
    anatomicRegion: v.optional(v.string()),
    clinicalHistory: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ findings: string; impression: string; technique: string; providerUsed: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ message: "No autenticado", code: "UNAUTHENTICATED" });

    // Intentar usar la config de IA del usuario
    const userConfigResult = await ctx.runQuery(internal.aiConfig._getConfigForAction, {
      tokenIdentifier: identity.tokenIdentifier,
    });

    const systemPrompt = `Eres un asistente especializado en redacción de informes radiológicos profesionales.
Tu función es ayudar al médico a elaborar un borrador estructurado para su revisión.
IMPORTANTE:
- Nunca emites diagnósticos definitivos.
- Solo sugieres hallazgos descriptivos, frases técnicas y una conclusión tentativa.
- El médico siempre revisa, corrige y aprueba el informe final.
- Redacta en español, en tono clínico y profesional.
- Sé conciso pero completo.
- Usa formato de párrafo limpio, sin listas con guiones.`;

    const userMessage = `Genera un borrador de informe radiológico con los siguientes datos:
Paciente: ${args.patientName}
Modalidad: ${args.modality}
Región anatómica: ${args.anatomicRegion ?? "No especificada"}
Indicación clínica: ${args.indication}
Historia clínica: ${args.clinicalHistory ?? "No proporcionada"}
Fecha del estudio: ${args.studyDate ?? "No especificada"}

Devuelve ÚNICAMENTE un JSON con esta estructura exacta (sin markdown, sin explicaciones adicionales):
{
  "technique": "Descripción técnica del procedimiento para ${args.modality}",
  "findings": "Hallazgos descriptivos del estudio (2-4 párrafos)",
  "impression": "Impresión diagnóstica sugerida (1-2 párrafos)"
}`;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    const config = userConfigResult?.config;
    const userId = userConfigResult?.userId;
    const hasUserConfig = config && config.encryptedKey && config.provider !== "ollama";
    const hasOllama = config && config.provider === "ollama";

    // Determinar qué proveedor usar
    let providerUsed = "hercules";
    const requestedAt = new Date().toISOString();
    const startMs = Date.now();

    // Helper interno para descifrar la key
    const SALT = "AFGMEDVIEW-AI-CONFIG-2026";
    const decryptKey = (encrypted: string): string => {
      const decoded = atob(encrypted);
      const result: number[] = [];
      for (let i = 0; i < decoded.length; i++) {
        result.push(decoded.charCodeAt(i) ^ SALT.charCodeAt(i % SALT.length));
      }
      return String.fromCharCode(...result);
    };

    let response: Response;
    const temperature = config?.temperature ?? 0.4;
    const maxTokens = config?.maxTokens ?? 1000;

    if (hasUserConfig && config) {
      // Usar proveedor configurado por el usuario
      const apiKey = decryptKey(config.encryptedKey!);
      providerUsed = config.provider;

      switch (config.provider) {
        case "openai": {
          const req = buildOpenAIRequest(
            "https://api.openai.com/v1", apiKey, config.model,
            messages, temperature, maxTokens
          );
          response = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body });
          break;
        }
        case "gemini": {
          // Gemini usa su propia API pero tiene endpoint compatible con OpenAI
          const req = buildOpenAIRequest(
            `https://generativelanguage.googleapis.com/v1beta/openai`, apiKey, config.model,
            messages, temperature, maxTokens
          );
          response = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body });
          break;
        }
        case "claude": {
          // Claude tiene su propia API (no compatible con OpenAI chat/completions)
          response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: config.model,
              max_tokens: maxTokens,
              system: systemPrompt,
              messages: [{ role: "user", content: userMessage }],
            }),
          });
          break;
        }
        case "openrouter": {
          const req = buildOpenAIRequest(
            "https://openrouter.ai/api/v1", apiKey, config.model,
            messages, temperature, maxTokens,
            { "HTTP-Referer": "https://afgmedview.app", "X-Title": "AFGMEDVIEW" }
          );
          response = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body });
          break;
        }
        case "azure": {
          const endpoint = config.azureEndpoint ?? "";
          const deployment = config.azureDeployment ?? "";
          const apiVersion = config.azureApiVersion ?? "2024-02-01";
          response = await fetch(
            `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
            {
              method: "POST",
              headers: { "api-key": apiKey, "content-type": "application/json" },
              body: JSON.stringify({ messages, temperature, max_tokens: maxTokens }),
            }
          );
          break;
        }
        default:
          throw new ConvexError({ message: "Proveedor de IA no soportado", code: "BAD_REQUEST" });
      }
    } else if (hasOllama && config) {
      // Ollama: no requiere API key, usa endpoint local del usuario
      providerUsed = "ollama";
      const host = config.ollamaHost ?? "localhost";
      const port = config.ollamaPort ?? 11434;
      response = await fetch(`http://${host}:${port}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: config.model,
          messages,
          stream: false,
          options: { temperature, num_predict: maxTokens },
        }),
      });
    } else {
      // Fallback: usar Hercules AI Gateway
      const apiKey = process.env.HERCULES_API_KEY;
      if (!apiKey) throw new ConvexError({ message: "Servicio de IA no disponible. Configure su proveedor en Configuración > IA.", code: "EXTERNAL_SERVICE_ERROR" });
      providerUsed = "hercules";
      response = await fetch("https://ai-gateway.hercules.app/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: "openai/gpt-5-mini",
          messages,
          temperature: 0.4,
          max_tokens: 1000,
        }),
      });
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      let userMsg = "Error al conectar con el servicio de IA.";
      if (response.status === 401 || response.status === 403) {
        userMsg = "API Key inválida o sin permisos. Verifique su configuración en Configuración > IA.";
      } else if (response.status === 429) {
        userMsg = "Límite de solicitudes alcanzado. Intente nuevamente en unos minutos.";
      } else if (response.status === 404) {
        userMsg = "Modelo no encontrado. Verifique el nombre del modelo en Configuración > IA.";
      } else if (errBody) {
        userMsg = `Error del proveedor (${response.status}): ${errBody.slice(0, 200)}`;
      }

      // Registrar log de error
      if (userId) {
        await ctx.runMutation(internal.aiConfig._logUsage, {
          userId,
          provider: providerUsed,
          model: config?.model ?? "gpt-5-mini",
          requestedAt,
          responseTimeMs: Date.now() - startMs,
          status: "error",
          errorType: `http_${response.status}`,
          errorMessage: userMsg,
        });
      }

      throw new ConvexError({ message: userMsg, code: "EXTERNAL_SERVICE_ERROR" });
    }

    const responseTimeMs = Date.now() - startMs;
    const data = await response.json() as Record<string, unknown>;

    // Extraer contenido según el proveedor
    let content = "";
    if (providerUsed === "claude") {
      // Claude response: data.content is an array of blocks
      const claudeContent = data.content as Array<{ type: string; text?: string }> | undefined;
      content = claudeContent?.find(b => b.type === "text")?.text ?? "";
    } else if (providerUsed === "ollama") {
      // Ollama chat response: data.message.content
      const ollamaMsg = data.message as { content?: string } | undefined;
      content = ollamaMsg?.content ?? "";
    } else {
      // OpenAI-compatible (openai, gemini, openrouter, azure, hercules)
      const choices = data.choices as Array<{ message?: { content?: string } }> | undefined;
      content = choices?.[0]?.message?.content ?? "";
    }

    const parsed = parseAIDraftContent(content, args.modality);

    // Guardar en la base de datos
    await ctx.runMutation(internal.aiReport._saveAIDraft, {
      reportId: args.reportId,
      findings: parsed.findings,
      impression: parsed.impression,
      technique: parsed.technique,
    });

    // Registrar log de uso exitoso
    if (userId) {
      await ctx.runMutation(internal.aiConfig._logUsage, {
        userId,
        provider: providerUsed,
        model: config?.model ?? "openai/gpt-5-mini",
        requestedAt,
        responseTimeMs,
        status: "success",
      });
    }

    return { ...parsed, providerUsed };
  },
});
