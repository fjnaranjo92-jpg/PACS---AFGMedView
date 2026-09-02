/**
 * Backend — Configuración de IA por usuario.
 *
 * Cada médico configura su propia cuenta de IA (API Key, proveedor, modelo).
 * Keys se almacenan cifradas y nunca se exponen completas al frontend.
 */
import { query, mutation, action, internalMutation, internalQuery } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import { internal } from "./_generated/api";
import type { MutationCtx, QueryCtx } from "./_generated/server";

// ─── Tipos de proveedor ──────────────────────────────────────────────────────

const providerValidator = v.union(
  v.literal("openai"),
  v.literal("gemini"),
  v.literal("claude"),
  v.literal("openrouter"),
  v.literal("azure"),
  v.literal("ollama")
);

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function requireAuthUser(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ message: "No autenticado", code: "UNAUTHENTICATED" });

  const user = await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
  if (!user) throw new ConvexError({ message: "Usuario no encontrado", code: "NOT_FOUND" });

  return user;
}

/**
 * Cifrado simple XOR + base64 para almacenar la key.
 * NO es criptografía fuerte, pero evita almacenamiento en texto plano.
 * Para producción se recomienda usar un KMS externo.
 */
const ENCRYPTION_SALT = "AFGMEDVIEW-AI-CONFIG-2026";

function encryptKey(plainKey: string): string {
  const result: number[] = [];
  for (let i = 0; i < plainKey.length; i++) {
    const charCode = plainKey.charCodeAt(i) ^ ENCRYPTION_SALT.charCodeAt(i % ENCRYPTION_SALT.length);
    result.push(charCode);
  }
  // Convierte a base64e string seguro
  return btoa(String.fromCharCode(...result));
}

function decryptKey(encrypted: string): string {
  const decoded = atob(encrypted);
  const result: number[] = [];
  for (let i = 0; i < decoded.length; i++) {
    const charCode = decoded.charCodeAt(i) ^ ENCRYPTION_SALT.charCodeAt(i % ENCRYPTION_SALT.length);
    result.push(charCode);
  }
  return String.fromCharCode(...result);
}

function maskKey(keyLast4: string | undefined): string {
  if (!keyLast4) return "••••••••••••";
  return `••••••••••••${keyLast4}`;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/** Obtiene la configuración de IA del usuario actual (sin key completa) */
export const getMyConfig = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;

    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
      .unique();
    if (!user) return null;

    const config = await ctx.db
      .query("aiConfig")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (!config) return null;

    // NUNCA devolver la key descifrada. Solo la máscara.
    return {
      _id: config._id,
      provider: config.provider,
      model: config.model,
      maskedKey: maskKey(config.keyLast4),
      hasKey: !!config.encryptedKey,
      temperature: config.temperature,
      maxTokens: config.maxTokens,
      azureEndpoint: config.azureEndpoint,
      azureDeployment: config.azureDeployment,
      azureApiVersion: config.azureApiVersion,
      ollamaHost: config.ollamaHost,
      ollamaPort: config.ollamaPort,
      connectionStatus: config.connectionStatus ?? "untested",
      lastTestedAt: config.lastTestedAt,
      lastErrorMessage: config.lastErrorMessage,
      updatedAt: config.updatedAt,
    };
  },
});

/** Admin: lista todas las configs (sin keys) para el panel de administración */
export const listAllConfigs = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    // Solo admin puede ver todas las configuraciones
    const configs = await ctx.db.query("aiConfig").collect();

    const results = [];
    for (const config of configs) {
      const user = await ctx.db.get(config.userId);
      results.push({
        _id: config._id,
        userId: config.userId,
        userName: user?.name ?? user?.email ?? "Desconocido",
        userEmail: user?.email,
        provider: config.provider,
        model: config.model,
        connectionStatus: config.connectionStatus ?? "untested",
        lastTestedAt: config.lastTestedAt,
        updatedAt: config.updatedAt,
      });
    }

    return results;
  },
});

/** Admin: obtener logs de uso de IA (más recientes primero) */
export const getUsageLogs = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return [];

    const limit = args.limit ?? 50;
    const logs = await ctx.db
      .query("aiUsageLogs")
      .order("desc")
      .take(limit);

    const results = [];
    for (const log of logs) {
      const user = await ctx.db.get(log.userId);
      results.push({
        ...log,
        userName: user?.name ?? user?.email ?? "Desconocido",
        userEmail: user?.email,
      });
    }

    return results;
  },
});

// ─── Mutations ───────────────────────────────────────────────────────────────

/** Guardar/actualizar configuración de IA del usuario */
export const saveConfig = mutation({
  args: {
    provider: providerValidator,
    apiKey: v.optional(v.string()),
    model: v.string(),
    temperature: v.optional(v.number()),
    maxTokens: v.optional(v.number()),
    azureEndpoint: v.optional(v.string()),
    azureDeployment: v.optional(v.string()),
    azureApiVersion: v.optional(v.string()),
    ollamaHost: v.optional(v.string()),
    ollamaPort: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireAuthUser(ctx);
    const now = new Date().toISOString();

    const existing = await ctx.db
      .query("aiConfig")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    // Preparar campos de key
    let encryptedKey = existing?.encryptedKey;
    let keyLast4 = existing?.keyLast4;

    if (args.apiKey && args.apiKey.trim() !== "") {
      // Nueva key proporcionada — cifrar y guardar
      encryptedKey = encryptKey(args.apiKey.trim());
      keyLast4 = args.apiKey.trim().slice(-4);
    }

    const configData = {
      provider: args.provider,
      model: args.model,
      encryptedKey,
      keyLast4,
      temperature: args.temperature,
      maxTokens: args.maxTokens,
      azureEndpoint: args.azureEndpoint,
      azureDeployment: args.azureDeployment,
      azureApiVersion: args.azureApiVersion,
      ollamaHost: args.ollamaHost,
      ollamaPort: args.ollamaPort,
      connectionStatus: "untested" as const,
      updatedAt: now,
    };

    if (existing) {
      await ctx.db.patch(existing._id, configData);
    } else {
      await ctx.db.insert("aiConfig", { userId: user._id, ...configData });
    }
  },
});

/** Eliminar configuración de IA del usuario */
export const deleteConfig = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await requireAuthUser(ctx);

    const existing = await ctx.db
      .query("aiConfig")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();

    if (existing) {
      await ctx.db.delete(existing._id);
    }
  },
});

/** Internal: actualizar estado de conexión tras una prueba */
export const _updateConnectionStatus = internalMutation({
  args: {
    configId: v.id("aiConfig"),
    connectionStatus: v.union(v.literal("connected"), v.literal("error")),
    lastTestedAt: v.string(),
    lastErrorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.configId, {
      connectionStatus: args.connectionStatus,
      lastTestedAt: args.lastTestedAt,
      lastErrorMessage: args.lastErrorMessage,
    });
  },
});

/** Internal: registrar un log de uso de IA */
export const _logUsage = internalMutation({
  args: {
    userId: v.id("users"),
    provider: v.string(),
    model: v.string(),
    requestedAt: v.string(),
    responseTimeMs: v.optional(v.number()),
    status: v.union(v.literal("success"), v.literal("error")),
    errorType: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("aiUsageLogs", args);
  },
});

// ─── Action: Probar conexión ─────────────────────────────────────────────────

export const testConnection = action({
  args: {},
  handler: async (ctx): Promise<{ success: boolean; message: string }> => {
    // Obtener identidad del usuario
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({ message: "No autenticado", code: "UNAUTHENTICATED" });
    }

    // Leer la config del usuario (necesitamos la key descifrada)
    const user = await ctx.runQuery(internal.aiConfig._getConfigForAction, {
      tokenIdentifier: identity.tokenIdentifier,
    });

    if (!user) {
      throw new ConvexError({ message: "Configuración no encontrada", code: "NOT_FOUND" });
    }

    const { config, userId } = user;
    const now = new Date().toISOString();

    if (!config.encryptedKey && config.provider !== "ollama") {
      await ctx.runMutation(internal.aiConfig._updateConnectionStatus, {
        configId: config._id,
        connectionStatus: "error",
        lastTestedAt: now,
        lastErrorMessage: "No hay API Key configurada",
      });
      return { success: false, message: "No hay API Key configurada" };
    }

    const apiKey = config.encryptedKey ? decryptKey(config.encryptedKey) : "";
    const startMs = Date.now();

    try {
      let testResponse: Response;

      switch (config.provider) {
        case "openai": {
          testResponse = await fetch("https://api.openai.com/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          break;
        }
        case "gemini": {
          testResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
          );
          break;
        }
        case "claude": {
          testResponse = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01",
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model: config.model || "claude-sonnet-4-20250514",
              max_tokens: 10,
              messages: [{ role: "user", content: "test" }],
            }),
          });
          break;
        }
        case "openrouter": {
          testResponse = await fetch("https://openrouter.ai/api/v1/models", {
            headers: { Authorization: `Bearer ${apiKey}` },
          });
          break;
        }
        case "azure": {
          const endpoint = config.azureEndpoint ?? "";
          const deployment = config.azureDeployment ?? "";
          const apiVersion = config.azureApiVersion ?? "2024-02-01";
          testResponse = await fetch(
            `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`,
            {
              method: "POST",
              headers: { "api-key": apiKey, "content-type": "application/json" },
              body: JSON.stringify({
                messages: [{ role: "user", content: "test" }],
                max_tokens: 5,
              }),
            }
          );
          break;
        }
        case "ollama": {
          const host = config.ollamaHost ?? "localhost";
          const port = config.ollamaPort ?? 11434;
          testResponse = await fetch(`http://${host}:${port}/api/tags`);
          break;
        }
        default:
          throw new Error("Proveedor no soportado");
      }

      const responseTimeMs = Date.now() - startMs;
      const success = testResponse.ok;
      let errorMessage: string | undefined;

      if (!success) {
        const errorBody = await testResponse.text().catch(() => "");
        if (testResponse.status === 401 || testResponse.status === 403) {
          errorMessage = "API Key inválida o sin permisos";
        } else if (testResponse.status === 404) {
          errorMessage = "Modelo o endpoint no encontrado";
        } else {
          errorMessage = `Error ${testResponse.status}: ${errorBody.slice(0, 200)}`;
        }
      }

      // Actualizar estado
      await ctx.runMutation(internal.aiConfig._updateConnectionStatus, {
        configId: config._id,
        connectionStatus: success ? "connected" : "error",
        lastTestedAt: now,
        lastErrorMessage: errorMessage,
      });

      // Registrar log
      await ctx.runMutation(internal.aiConfig._logUsage, {
        userId,
        provider: config.provider,
        model: config.model,
        requestedAt: now,
        responseTimeMs,
        status: success ? "success" : "error",
        errorType: success ? undefined : "connection_test",
        errorMessage,
      });

      return {
        success,
        message: success
          ? `Conexión exitosa (${responseTimeMs}ms)`
          : (errorMessage ?? "Error desconocido"),
      };
    } catch (error) {
      const responseTimeMs = Date.now() - startMs;
      const errMsg = error instanceof Error ? error.message : "Error de red";

      await ctx.runMutation(internal.aiConfig._updateConnectionStatus, {
        configId: config._id,
        connectionStatus: "error",
        lastTestedAt: now,
        lastErrorMessage: errMsg,
      });

      await ctx.runMutation(internal.aiConfig._logUsage, {
        userId,
        provider: config.provider,
        model: config.model,
        requestedAt: now,
        responseTimeMs,
        status: "error",
        errorType: "network_error",
        errorMessage: errMsg,
      });

      return { success: false, message: errMsg };
    }
  },
});

// ─── Internal query: obtener config completa (con key cifrada) para actions ──

export const _getConfigForAction = internalQuery({
  args: { tokenIdentifier: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", args.tokenIdentifier))
      .unique();
    if (!user) return null;

    const config = await ctx.db
      .query("aiConfig")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .first();
    if (!config) return null;

    return { config, userId: user._id };
  },
});
