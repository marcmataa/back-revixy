import nodemailer from "nodemailer";
import ActionLogs from "../models/ActionLogs.model.js";
import Store from "../models/Store.model.js";
import User from "../models/User.model.js";

function buildHtmlEmail({ storeName, alert }) {
  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:16px;color:#111827;">
      <h2 style="margin-bottom:12px;">REVIXY Critical Alert</h2>
      <p><strong>Store:</strong> ${storeName}</p>
      <p>${alert.message}</p>
      <p><strong>Affected metric:</strong> ${alert.affectedMetric}</p>
      <p><strong>Current value:</strong> ${alert.currentValue}</p>
      <p><strong>7-day average:</strong> ${alert.averageValue}</p>
      <a href="https://app.revixy.com/dashboard" style="display:inline-block;padding:10px 14px;background:#111827;color:#ffffff;text-decoration:none;border-radius:6px;">Open Dashboard</a>
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

async function sendCriticalAlertEmail({ to, storeName, alert }) {
  const subject = `🚨 REVIXY Alert: ${alert.title}`;
  const html = buildHtmlEmail({ storeName, alert });

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

    const [store, user] = await Promise.all([
      Store.findById(storeId).select("shopifyDomain").lean(),
      User.findById(userId).select("email").lean(),
    ]);

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
      criticalAlerts.map((alert) => sendCriticalAlertEmail({ to: user.email, storeName: store.shopifyDomain, alert }))
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
