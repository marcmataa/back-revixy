import OpenAI from "openai";
import crypto from "crypto";
import Store from "../models/Store.model.js";
import DailyStats from "../models/DailyStats.model.js";
import ActionLogs from "../models/ActionLogs.model.js";
import { generateAlertsForStore } from "./alertEngine.service.js";
import {
  buildSystemPrompt,
  buildBusinessContext,
  buildMessagesArray,
} from "./contextBuilder.service.js";
import {
  sanitizeUserInput,
  sanitizeAIOutput,
  sanitizeBusinessContext,
} from "./promptSanitizer.service.js";
import {
  getOrCreateSession,
  getRecentHistory,
  addMessage,
} from "./chatMemory.service.js";

let openaiClient = null;

const AI_CONFIG = {
  model: "gpt-4o-mini",
  max_tokens: 1000,
  temperature: 0.2,
  top_p: 0.9,
  frequency_penalty: 0.2,
};

const AI_LIMITS = {
  maxCallsPerStorePerHour: 20,
  maxTokensPerDay: 500000,
  minIntervalBetweenInsights: 30 * 60 * 1000,
};

function sameUtcDay(dateA, dateB) {
  return (
    dateA.getUTCFullYear() === dateB.getUTCFullYear() &&
    dateA.getUTCMonth() === dateB.getUTCMonth() &&
    dateA.getUTCDate() === dateB.getUTCDate()
  );
}

async function resetDailyTokenUsageIfNeeded(store) {
  const now = new Date();
  const lastResetAt = store?.aiUsage?.lastResetAt
    ? new Date(store.aiUsage.lastResetAt)
    : null;
  if (!lastResetAt || !sameUtcDay(lastResetAt, now)) {
    await Store.updateOne(
      { _id: store._id },
      { $set: { "aiUsage.dailyTokensUsed": 0, "aiUsage.lastResetAt": now } },
    );
    store.aiUsage.dailyTokensUsed = 0;
    store.aiUsage.lastResetAt = now;
  }
}

async function canRunAiCall(storeId, type = "GENERIC") {
  const store = await Store.findById(storeId).select("aiUsage").lean();
  if (!store) return { allowed: false, error: "STORE_NOT_FOUND" };

  const mutableStore = {
    ...store,
    aiUsage: store.aiUsage || { dailyTokensUsed: 0, lastResetAt: null },
  };
  await resetDailyTokenUsageIfNeeded(mutableStore);
  if (
    (mutableStore.aiUsage?.dailyTokensUsed || 0) >= AI_LIMITS.maxTokensPerDay
  ) {
    return { allowed: false, error: "RATE_LIMIT_EXCEEDED" };
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const callsInHour = await ActionLogs.countDocuments({
    storeId,
    type: { $in: ["AI_INSIGHT", "AI_SIMULATION"] },
    createdAt: { $gte: hourAgo },
  });
  if (callsInHour >= AI_LIMITS.maxCallsPerStorePerHour) {
    return { allowed: false, error: "RATE_LIMIT_EXCEEDED" };
  }

  if (type === "INSIGHT") {
    const lastInsight = await ActionLogs.findOne({
      storeId,
      type: "AI_INSIGHT",
      status: "SUCCESS",
    })
      .sort({ createdAt: -1 })
      .select("createdAt")
      .lean();
    if (
      lastInsight &&
      Date.now() - new Date(lastInsight.createdAt).getTime() <
        AI_LIMITS.minIntervalBetweenInsights
    ) {
      return { allowed: false, error: "RATE_LIMIT_EXCEEDED" };
    }
  }
  return { allowed: true };
}

async function appendDailyTokens(storeId, tokensUsed) {
  await Store.updateOne(
    { _id: storeId },
    {
      $inc: { "aiUsage.dailyTokensUsed": Number(tokensUsed) || 0 },
      $set: { "aiUsage.lastResetAt": new Date() },
    },
  );
}

async function callAI(messages, options = {}) {
  const config = { ...AI_CONFIG, ...options };
  try {
    // Comentario en español: evitamos romper el proceso si falta la API key.
    if (!process.env.OPENAI_API_KEY) {
      return { error: "AI_UNAVAILABLE" };
    }
    if (!openaiClient) {
      openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    }

    const completion = await openaiClient.chat.completions.create({
      model: config.model,
      messages,
      max_tokens: config.max_tokens,
      temperature: config.temperature,
      top_p: config.top_p,
      frequency_penalty: config.frequency_penalty,
    });

    const content = completion?.choices?.[0]?.message?.content || "";
    const tokensUsed = completion?.usage?.total_tokens || 0;
    if (options.storeId) {
      await appendDailyTokens(options.storeId, tokensUsed);
    }
    return { content, tokensUsed };
  } catch (error) {
    const statusCode = error?.status || error?.statusCode;
    const mappedError =
      statusCode === 429
        ? "AI_RATE_LIMITED"
        : statusCode === 503
          ? "AI_UNAVAILABLE"
          : "AI_ERROR";
    await ActionLogs.create({
      storeId: options.storeId,
      type: options.logType || "AI_INSIGHT",
      status: "FAIL",
      message: "AI call failed",
      metadata: { error: error.message, code: statusCode || null },
    });
    return { error: mappedError };
  }
}

function summarizeSnapshot(dailyStats, alerts) {
  const totalRoas = dailyStats.reduce(
    (acc, item) => acc + (Number(item.blendedROAS) || 0),
    0,
  );
  const totalNetProfit = dailyStats.reduce(
    (acc, item) => acc + (Number(item.netProfit) || 0),
    0,
  );
  const count = dailyStats.length || 1;
  return {
    avgROAS: totalRoas / count,
    avgNetProfit: totalNetProfit / count,
    alertCount: (alerts || []).length,
  };
}

function hasDiscrepancyOverFivePercent(narrative, dailyStats) {
  const aiNumbers = (String(narrative).match(/-?\d+(\.\d+)?/g) || []).map(
    Number,
  );
  const references = dailyStats.flatMap((item) => [
    Number(item.netProfit) || 0,
    Number(item.blendedROAS) || 0,
    Number(item.breakEvenROAS) || 0,
    Number(item.adSpend) || 0,
    Number(item.grossRevenue) || 0,
    Number(item.contributionMargin) || 0,
  ]);
  return aiNumbers.some((value) => {
    if (!Number.isFinite(value)) return false;
    return !references.some((ref) => {
      if (!Number.isFinite(ref)) return false;
      const base = Math.max(Math.abs(ref), 1);
      return Math.abs(value - ref) / base <= 0.05;
    });
  });
}

async function summarizeForCompression(compactMessages, storeId) {
  // Comentario en español: resumimos para contener tokens y mantener contexto útil.
  const result = await callAI(
    [
      {
        role: "system",
        content:
          "Summarize this conversation into 3-5 concise sentences focused on business context, decisions, and pending questions.",
      },
      { role: "user", content: compactMessages },
    ],
    { storeId, temperature: 0.2, max_tokens: 180, logType: "AI_INSIGHT" },
  );
  if (result.error)
    return "Previous messages covered metrics review and strategic follow-ups.";
  return sanitizeAIOutput(result.content);
}

async function generateInsight(storeId) {
  try {
    const limitCheck = await canRunAiCall(storeId, "INSIGHT");
    if (!limitCheck.allowed) return { error: limitCheck.error };

    const [store, dailyStats] = await Promise.all([
      Store.findById(storeId).select("currency settings aiUsage").lean(),
      DailyStats.find({ storeId }).sort({ date: -1 }).limit(14).lean(),
    ]);
    const alertsResult = await generateAlertsForStore(storeId);
    const alerts = alertsResult?.alerts || [];
    if (!store) return { error: "STORE_NOT_FOUND" };
    if (dailyStats.length < 7) return { error: "DATA_INSUFFICIENT" };

    const ordered = [...dailyStats].reverse();
    const systemPrompt = buildSystemPrompt(store);
    const businessContext = buildBusinessContext(ordered, alerts, store);
    const messages = buildMessagesArray(
      systemPrompt,
      businessContext,
      [],
      "<user_query>Generate a concise financial narrative insight.</user_query>",
    );

    const aiResult = await callAI(messages, {
      storeId,
      temperature: 0.2,
      logType: "AI_INSIGHT",
    });
    if (aiResult.error) return { error: aiResult.error };

    const narrative = sanitizeAIOutput(aiResult.content);
    const discrepancy = hasDiscrepancyOverFivePercent(narrative, ordered);
    if (discrepancy) {
      console.warn(
        "AI_DISCREPANCY_DETECTED — narrative may contain inconsistent numbers",
      );
    }

    const latest = ordered[ordered.length - 1];
    const snapshot = summarizeSnapshot(ordered, alerts);
    await ActionLogs.create({
      storeId,
      type: "AI_INSIGHT",
      status: "SUCCESS",
      message: "Narrative insight generated",
      metadata: { tokensUsed: aiResult.tokensUsed, alertCount: alerts.length },
    });

    return {
      insightId: crypto.randomUUID(),
      storeId,
      type: "NARRATIVE_INSIGHT",
      severity: "INFO",
      narrative,
      confidenceScore: Number(latest?.confidenceScore) || 0,
      dataWindow: ordered.length >= 14 ? "last_14_days" : "last_7_days",
      generatedAt: new Date(),
      dataSnapshot: {
        dateRange: {
          from: ordered[0]?.date,
          to: ordered[ordered.length - 1]?.date,
        },
        avgROAS: snapshot.avgROAS,
        avgNetProfit: snapshot.avgNetProfit,
        alertCount: snapshot.alertCount,
      },
    };
  } catch (error) {
    await ActionLogs.create({
      storeId,
      type: "AI_INSIGHT",
      status: "FAIL",
      message: "Insight flow failed",
      metadata: { error: error.message },
    });
    return { error: "AI_ERROR" };
  }
}

async function chat(storeId, sessionId, userMessage) {
  try {
    const limitCheck = await canRunAiCall(storeId, "CHAT");
    if (!limitCheck.allowed) return { error: limitCheck.error };

    let sanitizedUserMessage = "";
    try {
      sanitizedUserMessage = sanitizeUserInput(userMessage);
    } catch (error) {
      await ActionLogs.create({
        storeId,
        type: "AI_INSIGHT",
        status: "FAIL",
        message: "Prompt injection detected",
        metadata: { reason: "INJECTION_DETECTED" },
      });
      return { error: "INJECTION_DETECTED" };
    }

    const session = await getOrCreateSession(storeId, sessionId);
    const history = await getRecentHistory(session.sessionId);
    const [store, dailyStats] = await Promise.all([
      Store.findById(storeId).select("currency settings aiUsage").lean(),
      DailyStats.find({ storeId }).sort({ date: -1 }).limit(7).lean(),
    ]);
    if (!store) return { error: "STORE_NOT_FOUND" };

    // Comentario en español: saneamos todo el contexto antes de enviarlo al modelo.
    const businessContext = buildBusinessContext(
      [...dailyStats].reverse(),
      [],
      store,
    );
    const systemPrompt = buildSystemPrompt(store);
    const messages = buildMessagesArray(
      systemPrompt,
      businessContext,
      history,
      sanitizedUserMessage,
    );

    const aiResult = await callAI(messages, {
      storeId,
      temperature: 0.2,
      logType: "AI_INSIGHT",
    });
    if (aiResult.error) return { error: aiResult.error };

    const response = sanitizeAIOutput(aiResult.content);
    await addMessage(session.sessionId, {
      role: "user",
      content: sanitizedUserMessage,
      tokensUsed: 0,
    });
    await addMessage(
      session.sessionId,
      { role: "assistant", content: response, tokensUsed: aiResult.tokensUsed },
      async (compactMessages) =>
        summarizeForCompression(compactMessages, storeId),
    );

    return {
      response,
      sessionId: session.sessionId,
      tokensUsed: aiResult.tokensUsed,
    };
  } catch (error) {
    await ActionLogs.create({
      storeId,
      type: "AI_INSIGHT",
      status: "FAIL",
      message: "Chat flow failed",
      metadata: { error: error.message },
    });
    return { error: "AI_ERROR" };
  }
}

async function simulateAction(storeId, action) {
  try {
    const limitCheck = await canRunAiCall(storeId, "SIMULATION");
    if (!limitCheck.allowed) return { error: limitCheck.error };

    const [store, dailyStats] = await Promise.all([
      Store.findById(storeId).select("currency settings aiUsage").lean(),
      DailyStats.find({ storeId }).sort({ date: -1 }).limit(7).lean(),
    ]);
    if (!store) return { error: "STORE_NOT_FOUND" };
    if (dailyStats.length < 7) return { error: "DATA_INSUFFICIENT" };

    const actionPayload = sanitizeBusinessContext({
      action,
      recentStats: dailyStats.map((item) => ({
        date: item.date,
        netProfit: item.netProfit,
        blendedROAS: item.blendedROAS,
        adSpend: item.adSpend,
        confidenceScore: item.confidenceScore,
      })),
      store: { currency: store.currency, settings: store.settings },
    });

   const messages = [
  {
    role: "system",
    content: buildSystemPrompt(store) + `

## SIMULATION MODE — ACTIVE
You are now in financial simulation mode. Your ONLY task is to estimate the impact of the proposed action.

### HIDDEN REASONING STEP (run this BEFORE generating any output — never show this to the user)
0. **GOLDEN CALCULATION RULE:** Convert ALL values from CENTS to ${store?.currency || "EUR"} (value / 100) BEFORE any mathematical operation. Example: adSpend 50000 → 500,00 ${store?.currency || "EUR"}. Never mix cents and currency units in the same calculation.
1. Calculate CPA: (adSpend / 100) / clicks = CPA in ${store?.currency || "EUR"}
2. Calculate AOV: (grossRevenue / 100) / orderCount = AOV in ${store?.currency || "EUR"}
3. Calculate lost orders if pausing: (adSpend / 100 per day) / CPA = estimated lost orders
4. Calculate gross revenue loss: lost orders × AOV
5. Apply Halo Effect: add 5-10% to revenue loss for indirect traffic impact
6. Apply 20% Rule: pessimistic scenario must show at least 20% negative deviation from current ROAS
7. Validate: do your estimates make mathematical sense with the provided data?
Only THEN generate the response.

### SIMULATION RULES (NON-NEGOTIABLE)
1. Use ONLY data provided in the business context. Never invent metrics.
2. **CENTS RULE:** All values in context are in CENTS. Always divide by 100 before showing or calculating. Output always in ${store?.currency || "EUR"}.
3. Express impact as a RANGE — never a single number.
4. Base estimates on the last 7 days of provided data.
5. If confidenceScore < 60 or data is insufficient → return JSON with error: "SIMULATION_INSUFFICIENT_DATA"
6. Never recommend executing an action without explicitly stating the risk.
7. **Halo Effect:** Pausing a Top-of-Funnel campaign reduces organic and retargeting traffic by an additional 5-10% beyond direct revenue.
8. **20% Rule:** Pessimistic scenario must contemplate at least 20% negative deviation from current ROAS.
9. **Diminishing Returns:** Never assume linear scaling. SCALE_BUDGET revenue increase = additional spend × blendedROAS × 0.7
10. **Attribution window:** Meta Ads data has a 7-day attribution delay. Impact may not be visible for 3-7 days.
11. **Dynamic params:** Use any numeric values present in the action params to feed the formulas, regardless of the key name. Example: if params contains { amount: 100 } or { percent: 20 } or { budgetIncrease: 500 }, use whatever numeric value is present.

### ACTION-SPECIFIC CALCULATIONS
- **PAUSE_CAMPAIGN:**
  → Daily adSpend saved: (adSpend / 100) / 7
  → Estimated lost orders: daily adSpend saved / CPA
  → Gross revenue loss: lost orders × AOV
  → Halo Effect loss: gross revenue loss × 0.075 (7.5% midpoint)
  → Net saving: daily adSpend saved − gross revenue loss − halo effect loss

- **SCALE_BUDGET:**
  → Additional spend (from params, any numeric key): convert to ${store?.currency || "EUR"} if in cents
  → Expected revenue (diminishing returns): additional spend × blendedROAS × 0.7
  → Risk check: if blendedROAS < breakEvenROAS × 1.2 → flag as HIGH RISK
  → Break-even check: will new total spend stay above breakEvenROAS?

- **RESTOCK:**
  → Daily revenue at risk: (grossRevenue / 100) / 7
  → Total revenue at risk: days until stockout × daily revenue
  → Compare restock cost (from params) vs total revenue at risk

### OUTPUT FORMAT (MANDATORY — respond ONLY with valid JSON, no markdown, no extra text)
\`\`\`json
{
  "action": "[action type]",
  "baseCalculation": {
    "cpa": "[X,XX ${store?.currency || "EUR"}]",
    "aov": "[X,XX ${store?.currency || "EUR"}]",
    "dailyAdSpend": "[X,XX ${store?.currency || "EUR"}]"
  },
  "optimisticScenario": {
    "description": "[description]",
    "estimatedImpact": "[range in ${store?.currency || "EUR"}]",
    "confidence": 0
  },
  "pessimisticScenario": {
    "description": "[description — must apply 20% rule]",
    "estimatedImpact": "[range in ${store?.currency || "EUR"}]",
    "confidence": 0
  },
  "haloEffect": "[only for PAUSE_CAMPAIGN — indirect traffic impact estimate]",
  "attributionWindow": "[when will the impact be visible?]",
  "overallConfidence": 0,
  "recommendation": "[one clear sentence in ${store?.language === 'en' ? 'English' : store?.language === 'ca' ? 'Catalan' : 'Spanish'}]",
  "mainRisk": "[one sentence about the biggest risk]",
  "dataWindow": "last_7_days"
}
\`\`\`
`,
  },
  {
    role: "user",
    content: `<user_query>Simulate this action: ${JSON.stringify(actionPayload)}</user_query>`,
  },
];

    const aiResult = await callAI(messages, {
      storeId,
      temperature: 0.1,
      max_tokens: 300,
      logType: "AI_SIMULATION",
    });
    if (aiResult.error) return { error: aiResult.error };

    const sanitized = sanitizeAIOutput(aiResult.content);
   // Limpiamos backticks que GPT puede añadir aunque se le pida JSON puro
const cleanResponse = sanitized
  .replace(/```json\s*/gi, "")
  .replace(/```\s*/gi, "")
  .trim();

// Intentamos parsear como JSON — si falla devolvemos texto plano sin romper el flujo
let parsedResult;
try {
  parsedResult = JSON.parse(cleanResponse);
} catch {
  // Si no es JSON válido lo devolvemos como texto — mejor respuesta parcial que error
  parsedResult = { recommendation: cleanResponse, dataWindow: "last_7_days" };
}

await ActionLogs.create({
  storeId,
  type: "AI_SIMULATION",
  status: "SUCCESS",
  message: "Action simulation generated",
  metadata: { action: action?.type, tokensUsed: aiResult.tokensUsed },
});

return {
  action: action?.type,
  estimatedImpact: {
    bestCase: parsedResult?.optimisticScenario?.description ?? cleanResponse,
    worstCase: parsedResult?.pessimisticScenario?.description ?? "Potential downside depends on conversion stability.",
    confidence: (parsedResult?.overallConfidence ?? Number(dailyStats[dailyStats.length - 1]?.confidenceScore)) || 0,
  },
  recommendation: parsedResult?.recommendation ?? cleanResponse,
  dataWindow: parsedResult?.dataWindow ?? "last_7_days",
  fullSimulation: parsedResult,
};
  } catch (error) {
    await ActionLogs.create({
      storeId,
      type: "AI_SIMULATION",
      status: "FAIL",
      message: "Simulation flow failed",
      metadata: { error: error.message },
    });
    return { error: "AI_ERROR" };
  }
}

export { AI_CONFIG, AI_LIMITS, callAI, generateInsight, chat, simulateAction };
