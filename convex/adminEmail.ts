"use node";

import escapeHtml from "escape-html";
import { Hercules } from "@usehercules/sdk";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";

const hercules = new Hercules({
  apiKey: process.env.HERCULES_API_KEY!,
  apiVersion: "2025-12-09",
});

/** Correo del administrador — configurable via settings key "admin_email" */
const DEFAULT_ADMIN_EMAIL = "afgmedview@gmail.com";

export const sendAdminOtp = internalAction({
  args: { code: v.string(), adminEmail: v.string() },
  handler: async (_ctx, { code, adminEmail }) => {
    const to = adminEmail || DEFAULT_ADMIN_EMAIL;
    await hercules.email.send({
      from: "AFG MedView <afgmedview@gmail.com>",
      to,
      subject: `Código de acceso al Back Office: ${code}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
          <h2 style="color: #1a5276;">AFG MedView — Verificación de Acceso</h2>
          <p>Se ha solicitado acceso al panel administrativo de AFG MedView.</p>
          <div style="background: #f4f6f7; border-radius: 8px; padding: 24px; text-align: center; margin: 20px 0;">
            <p style="font-size: 14px; color: #555; margin: 0 0 8px;">Su código de verificación es:</p>
            <span style="font-size: 40px; font-weight: bold; color: #1a5276; letter-spacing: 8px;">${escapeHtml(code)}</span>
            <p style="font-size: 12px; color: #888; margin: 12px 0 0;">Válido por 10 minutos</p>
          </div>
          <p style="font-size: 13px; color: #888;">
            Si no solicitó este código, puede ignorar este mensaje. Alguien ingresó las credenciales correctas del panel administrativo.
          </p>
        </div>
      `,
      text: `Su código de acceso al Back Office de AFG MedView es: ${code}\n\nVálido por 10 minutos.`,
    });
  },
});
