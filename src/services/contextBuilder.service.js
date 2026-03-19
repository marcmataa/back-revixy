import { sanitizeBusinessContext } from "./promptSanitizer.service.js";

const TOKEN_BUDGET = {
  systemPrompt: 800,
  businessContext: 3500,
  chatHistory: 1200,
  userMessage: 300,
  safetyBuffer: 200,
  total: 6000,
};

function estimateTokens(payload) {
  return Math.ceil(JSON.stringify(payload || "").length / 4);
}

function buildSystemPrompt(store) {
  const currency = store?.currency || "EUR";
  return [
    "You are REVIXY, an AI Revenue Copilot for e-commerce profitability.",
    "Use only provided data. Never invent metrics, values, or events.",
    "All money values in context are in CENTS. Convert to readable currency output only.",
    `Format monetary outputs in ${currency}.`,
    "If confidenceScore < 60 or data window < 7 days, answer with DATA_INSUFFICIENT.",
    "Never recommend pausing or scaling from a single day snapshot.",
    "Prioritize loss prevention, then growth, and keep guidance grounded in the dataset.",
  ].join("\n");
}

function mapStat(stat) {
  return {
    date: stat?.date,
    netProfit: Number(stat?.netProfit) || 0,
    blendedROAS: Number(stat?.blendedROAS) || 0,
    breakEvenROAS: Number(stat?.breakEvenROAS) || 0,
    adSpend: Number(stat?.adSpend) || 0,
    grossRevenue: Number(stat?.grossRevenue) || 0,
    contributionMargin: Number(stat?.contributionMargin) || 0,
    confidenceScore: Number(stat?.confidenceScore) || 0,
    dataFlags: Array.isArray(stat?.dataFlags) ? stat.dataFlags : [],
  };
}

function buildBusinessContext(dailyStats, alerts, store) {
  const orderedStats = Array.isArray(dailyStats) ? dailyStats.slice(-14).map(mapStat) : [];
  const payload = {
    dailyStats: orderedStats,
    alerts: Array.isArray(alerts) ? alerts : [],
    store: {
      currency: store?.currency || "EUR",
      settings: {
        defaultMarginPercent: Number(store?.settings?.defaultMarginPercent) || 0,
        executionMode: store?.settings?.executionMode || "COPILOT",
      },
    },
  };

  let sanitizedPayload = sanitizeBusinessContext(payload);
  if (estimateTokens(sanitizedPayload) > TOKEN_BUDGET.businessContext) {
    sanitizedPayload = sanitizeBusinessContext({
      ...payload,
      dailyStats: orderedStats.slice(-7),
    });
  }
  return sanitizedPayload;
}

function trimChatHistory(chatHistory) {
  const history = Array.isArray(chatHistory) ? chatHistory.slice(-10) : [];
  if (estimateTokens(history) <= TOKEN_BUDGET.chatHistory) return history;
  return history.slice(-6);
}

function buildMessagesArray(systemPrompt, businessContext, chatHistory, userMessage) {
  const safeHistory = trimChatHistory(chatHistory);
  const safeUserMessage = String(userMessage || "").slice(0, TOKEN_BUDGET.userMessage * 4);
  return [
    {
      role: "system",
      content: `${systemPrompt}\n\nBUSINESS CONTEXT:\n${JSON.stringify(businessContext)}`,
    },
    ...safeHistory,
    { role: "user", content: safeUserMessage },
  ];
}

export {
  TOKEN_BUDGET,
  estimateTokens,
  buildSystemPrompt,
  buildBusinessContext,
  buildMessagesArray,
};
