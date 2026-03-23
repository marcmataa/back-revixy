import nodemailer from "nodemailer";
import ActionLogs from "../models/ActionLogs.model.js";
import Store from "../models/Store.model.js";
import User from "../models/User.model.js";
import { getT } from "../config/i18n.config.js";

function buildHtmlEmail({ storeName, alert, language, currency = "EUR" }) {
  const t = getT(language);
  const alertKey = alert.type.toLowerCase();
  // Usamos FRONTEND_URL del entorno — nunca hardcodeado para que funcione en local y producción
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

  const translatedTitle = t.alerts[alertKey] ?? t.alerts.default ?? alert.title;
  const translatedMessage = t.messages.generic?.(alert.message) ?? alert.message;

  // Las métricas monetarias vienen en céntimos — dividimos por 100 antes de mostrar
  const MONETARY_METRICS = [
    "netProfit", "grossRevenue", "netRevenue", "adSpend",
    "revenue", "shippingCosts", "gatewayFees", "cogs",
  ];
  const isMonetary = MONETARY_METRICS.includes(alert.affectedMetric);
  const formatValue = (val) =>
    isMonetary
      ? `${(Number(val) / 100).toFixed(2)} ${currency}`
      : String(val ?? "N/A");

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:16px;color:#111827;">
      <h2 style="margin-bottom:12px;">${t.email.critical_alert} — REVIXY</h2>
      <p><strong>${t.email.store}:</strong> ${storeName}</p>
      <p>${translatedTitle}</p>
      <p>${translatedMessage}</p>
      <p><strong>${t.email.affected_metric}:</strong> ${alert.affectedMetric}</p>
      <p><strong>${t.email.current_value}:</strong> ${formatValue(alert.currentValue)}</p>
      <p><strong>${t.email.average_value}:</strong> ${formatValue(alert.averageValue)}</p>
      <a href="${frontendUrl}/dashboard"
         style="display:inline-block;padding:10px 14px;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px;">
        ${t.email.open_dashboard}
      </a>
    </div>
  `;
}

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

async function sendCriticalAlertEmail({ to, storeName, alert, language, currency }) {
  const t = getT(language);
  const alertKey = alert.type.toLowerCase();

  // Subject traducido con triple fallback — nunca falla silenciosamente
  const subject = t.alerts[alertKey] ?? t.alerts.default ?? `🚨 REVIXY Alert: ${alert.title}`;
  const html = buildHtmlEmail({ storeName, alert, language, currency });

  try {
    if (process.env.NODE_ENV !== "production") {
      // En desarrollo no enviamos email real para evitar ruido y costes.
      console.log("[REVIXY_EMAIL_PREVIEW]", { to, subject, html });
      return { success: true, preview: true };
    }

    const transporter = createTransporter();
    await transporter.sendMail({
      from: process.env.SMTP_FROM || "alerts@revixy.com",
      to,
      subject,
      html,
    });
    return { success: true };
  } catch (error) {
    await ActionLogs.create({
      type: "API_ERROR",
      status: "FAIL",
      message: "Failed to send critical alert email",
      metadata: { error: error.message },
    });
    return { success: false };
  }
}

async function notifyIfCritical({ storeId, userId, alerts }) {
  try {
    const criticalAlerts = (alerts || []).filter((alert) => alert.severity === "CRITICAL");
    if (!criticalAlerts.length) return { notified: false, count: 0 };

    // Añadimos language y currency al select para pasarlos al builder de emails
    const [store, user] = await Promise.all([
      Store.findById(storeId).select("shopifyDomain language currency").lean(),
      User.findById(userId).select("email").lean(),
    ]);

    // El null check existente debe permanecer aquí — no eliminar
    if (!store || !user?.email) {
      await ActionLogs.create({
        storeId,
        userId,
        type: "API_ERROR",
        status: "FAIL",
        message: "Critical alert email skipped due to missing store or user email",
      });
      return { notified: false, count: 0 };
    }

    const results = await Promise.all(
      criticalAlerts.map((alert) =>
        sendCriticalAlertEmail({
          to: user.email,
          storeName: store.shopifyDomain,
          alert,
          language: store?.language,          // getT se encarga del fallback si es undefined
          currency: store?.currency || "EUR", // fallback a EUR si no está configurado
        })
      )
    );

    const successful = results.filter((result) => result.success).length;
    await ActionLogs.create({
      storeId,
      userId,
      type: "API_CALL",
      status: successful === criticalAlerts.length ? "SUCCESS" : "FAIL",
      message: "Critical alert email sent",
      metadata: { attempted: criticalAlerts.length, successful },
    });

    return { notified: successful > 0, count: successful };
  } catch (error) {
    await ActionLogs.create({
      storeId,
      userId,
      type: "API_ERROR",
      status: "FAIL",
      message: "Critical alert notification flow failed",
      metadata: { error: error.message },
    });
    return { notified: false, count: 0 };
  }
}

export { sendCriticalAlertEmail, notifyIfCritical };
