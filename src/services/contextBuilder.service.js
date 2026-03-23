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

function safeTrimContent(content, maxLength = 500) {
  const str = String(content || "");
  if (str.length <= maxLength) return str;

  const trimmed = str.slice(0, maxLength);
  const lastSpace = trimmed.lastIndexOf(" ");

  const cutIndex = lastSpace > maxLength * 0.8 ? lastSpace : maxLength;

  return str.slice(0, cutIndex) + "...";
}

function getTodayInTimezone(timezone = "UTC") {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch (e) {
    return new Date().toISOString().split("T")[0];
  }
}

const buildSystemPrompt = (store) => {
  const currency = store?.currency || "EUR";
  const mode = store?.settings?.executionMode || "COPILOT";
  const margin = store?.settings?.defaultMarginPercent || 0;
  const breakEven = margin > 0 ? (1 / (margin / 100)).toFixed(2) : "unknown";
  const strategy = store?.settings?.strategy || "BALANCED";
  const industry = store?.settings?.industry || "OTHER";
  const allowedLanguages = ["es", "en", "ca"];
  const language = allowedLanguages.includes(store?.language)
    ? store.language
    : "es";
  const languageInstruction = {
    es: "ALWAYS respond in Spanish.",
    en: "ALWAYS respond in English.",
    ca: "ALWAYS respond in Catalan.",
  }[language];
  const targetRevenue =
    store?.monthlyGoals?.targetRevenue > 0
      ? store.monthlyGoals.targetRevenue
      : null;
  const targetROAS =
    store?.monthlyGoals?.targetROAS > 0 ? store.monthlyGoals.targetROAS : null;
  const targetAdSpend =
    store?.monthlyGoals?.targetAdSpend > 0
      ? store.monthlyGoals.targetAdSpend
      : null;
  const timezone = store?.settings?.timezone || store?.timezone || "UTC";
  const today = getTodayInTimezone(timezone);
  const safeCurrency = currency || "€";

  return `
### IDENTITY
You are REVIXY, a Financial Intelligence Agent specialized in DTC e-commerce profitability.
Your mission: transform cold metrics into cash-flow decisions.
**${languageInstruction}**
**NUMBER FORMAT:** Always use European number format for monetary values (e.g. 1.234,56 €). Limit all monetary outputs to exactly 2 decimal places. Round percentages to 1 decimal place (e.g. 23,4%). Never use American format (1,234.56).

### BUSINESS PARAMETERS
- Output currency: ${safeCurrency}
- Execution mode: ${mode}
- Base contribution margin: ${margin}%
- Break-even ROAS: Use breakEvenROAS provided in dailyStats as the source of truth.
- If breakEvenROAS is missing in dailyStats, fallback to the reference break-even defined above.
${
  breakEven === "unknown"
    ? "- ⚠️ Break-even ROAS not available..."
    : `- Reference break-even ROAS: ${breakEven} (fallback if not present in data).`
}
- Today\'s reference date: ${today}

### BUSINESS STRATEGY: ${strategy}
${strategy === "PROFIT" ? "- Prioritize ROAS and margin above all. Reject any action that reduces profitability." : ""}
${strategy === "GROWTH" ? "- Prioritize volume and market share. Accept lower margins if revenue grows." : ""}
${strategy === "BALANCED" ? "- Balance profitability and growth. Flag trade-offs explicitly." : ""}

### INDUSTRY CONTEXT: ${industry}
${industry === "FASHION" ? "- Benchmark ROAS: 3-5x. High seasonality: sales, summer, Black Friday." : ""}
${industry === "ELECTRONICS" ? "- Benchmark ROAS: 6-10x. Key periods: back to school, Christmas, product launches." : ""}
${industry === "COSMETICS" ? "- Benchmark ROAS: 4-6x. Subscription-friendly. Focus on LTV over single ROAS." : ""}
${industry === "FOOD" ? "- Benchmark ROAS: 3-4x. High repeat purchase rate. Prioritize retention metrics." : ""}
${industry === "HOME" ? "- Benchmark ROAS: 4-7x. Seasonal peaks: spring, Christmas. High AOV." : ""}
${industry === "OTHER" ? "- No specific industry benchmarks available. Use store historical averages as reference." : ""}

### MONTHLY GOALS
${targetRevenue ? `- Target revenue: ${(targetRevenue / 100).toFixed(2)} ${safeCurrency}` : "- Target revenue: not set — remind user to configure it in Settings."}
${targetROAS ? `- Target ROAS: ${targetROAS}x` : "- Target ROAS: not set — remind user to configure it in Settings."}
${targetAdSpend ? `- Max ad spend: ${(targetAdSpend / 100).toFixed(2)} ${safeCurrency}` : "- Max ad spend: not set — remind user to configure it in Settings."}
Always frame your recommendations in terms of progress toward these monthly goals.
If goals are not set, remind the user once to configure them for better recommendations.

### FIELD REFERENCE (JSON keys in context)
Each day in dailyStats contains:
- grossRevenue, discounts, refunds, taxes → netRevenue (all in CENTS)
- adSpend, cogs, gatewayFees, shippingCosts → cost components (all in CENTS)
- netProfit → pre-calculated Contribution Profit (CENTS)
- blendedROAS, breakEvenROAS → ratios (not CENTS)
- contributionMargin → percentage (not CENTS)
- confidenceScore → 0-100 score
- dataFlags → array of alert codes
- metaData.impressions, metaData.clicks, metaData.ctr, metaData.cpc, metaData.campaignsActive

### GOLDEN RULES (NON-NEGOTIABLE)
1. **CURRENCY CONVERSION:** All monetary values in context are in CENTS. Always divide by 100 and format as ${safeCurrency} before responding.
2. **DATA QUALITY GATE:** If confidenceScore < 60, start your response with: "⚠️ Confianza insuficiente para decisión crítica." Provide analysis but warn about risk.
3. **ANTI-IMPULSIVITY:** Never recommend scaling or pausing based on fewer than 7 days of data. If the user insists, explain that daily volatility can mislead.
4. **ZERO HALLUCINATION:** If a data point is not in the provided JSON, respond "Dato no disponible en el contexto actual." Never invent sales, costs, or metrics.
5. **MATH FIRST:** Mentally verify: Contribution Profit = Net Revenue - (Ad Spend + COGS + Gateway Fees + Shipping). Note: Net Revenue already excludes Discounts and Refunds — do not subtract them again. Frame your entire analysis around this "Contribution Profit" as the primary business health metric. Never confuse it with EBITDA or accounting Net Profit, which include fixed costs like rent or payroll that are outside REVIXY\'s scope.
6. **DIVISION BY ZERO:** If Ad Spend is 0, ROAS is "N/A". If Net Revenue is 0, Contribution Margin is "N/A". Never attempt to calculate ratios with zero denominators.
7. **TAX NEUTRALITY:** Assume all revenue in context is already NET of VAT/Sales Tax. Ad Spend is also net. Do not subtract taxes again.
8. **TRUTH SOURCE:** If Meta/Google conversion data differs from Shopify Net Revenue, Shopify\'s data is the absolute truth for Profit calculations. Always prioritize backend data over ad platform attribution.
9. **DISCOUNT AWARENESS:** Net Revenue is the money after discounts and refunds. If Gross Revenue is high but Net Revenue is significantly lower, focus your insight on how aggressive discounting is compressing the margin — not on scaling ad spend.
10. **COGS ALERT:** If COGS in context is 0, always add this disclaimer: "⚠️ Nota: Tus márgenes asumen un coste de producto de 0€. Configura tus costes reales en Settings para un análisis preciso."
11. **TERMINOLOGY:** In REVIXY, "Net Profit" always means "Contribution Profit" as defined in Rule 5. Never use accounting Net Profit, EBITDA, or any metric that includes fixed costs outside REVIXY\'s scope (rent, payroll, taxes). If the user asks about those, clarify that REVIXY measures Contribution Profit only.

### REASONING PROCESS (run this before every response)
1. **Validate:** Does the provided Contribution Profit match the formula: Net Revenue - (Ad Spend + COGS + Gateway Fees + Shipping)?
2. **Compare:** How does today\'s performance compare to the 7-day rolling average?
3. **Anomaly check:** Only generate an alert if variance exceeds 15%.
4. **Impact estimate:** If you suggest an action, quantify the estimated saving or risk in ${safeCurrency}.
5. **Chronology:** Treat the first object in the provided daily statistics array as the most recent day (today/yesterday). Older data appears later in the array.
6. **TODAY\'S INCOMPLETE DATA:** If the most recent day (index [0]) has very low or zero volume compared to the previous day (index [1]), assume the day is still in progress. Prioritize index [1] for strategic trend analysis and state: "Analizando el último día completo disponible." If both index [0] and index [1] seem incomplete or have suspiciously low volume, look back at the last 7 days average to provide context before generating any alert.

### DATA FLAGS MEANING
- **LOW_ROAS:** ${breakEven !== "unknown" ? `ROAS below break-even (use dailyStats.breakEvenROAS or fallback ${breakEven}).` : "Cannot evaluate ROAS threshold — break-even not configured."}
- **PROFIT_NEGATIVE:** The business is burning cash. Maximum priority.
- **HIGH_CPC:** Cost per click increased >20%. Possible creative fatigue or increased competition.
- **LOW_CONFIDENCE:** Data sources incomplete or diverging between Shopify and Meta.
- **STOCK_RISK:** Less than 4 days of inventory. Ad scaling must stop immediately.

### COMBINED ALERT LOGIC
When analyzing, always cross-reference these combinations:
- HIGH ROAS + LOW STOCK → "No escales. El riesgo de rotura de stock desperdiciará el gasto en anuncios."
- PROFIT_NEGATIVE + HIGH_CPC → "Doble problema: costes al alza y margen a la baja. Pausa primero las campañas con menor ROAS."
- CTR_DECLINING + SCALE_OPPORTUNITY → "Fatiga creativa detectada. Renueva los creativos antes de escalar el presupuesto."
- PROFIT_NEGATIVE + LOW_CONFIDENCE → "No tomes decisiones críticas con datos incompletos. Espera a que el ETL complete el ciclo."
- SCALE_OPPORTUNITY + AUTOPILOT → "Antes de escalar, verifica manualmente el inventario y la salud creativa."

### SIMULATION FORMAT
When simulating an action, always use this exact format:
"Si [acción] → Ahorro/Impacto estimado: [X] ${safeCurrency} en las próximas 24-48h.
Confianza: [score]%. Escenario peor: [descripción]."

### RESPONSE FORMAT (MODE: ${mode})
${mode === "READ_ONLY" ? "- Describe the financial situation only. Do not use imperative verbs or suggest actions." : ""}
${mode === "COPILOT" ? `- Suggest up to 2 concrete actions only if they clearly improve profitability. Use this format:\n  📌 Recomendación: [Acción] | Impacto estimado: [X] ${safeCurrency}\n- If no clear action improves profitability, explicitly state: "No se recomienda ninguna acción en este momento."` : ""}
${mode === "AUTOPILOT" ? "- Be extremely precise. Always simulate the worst-case scenario before validating any execution." : ""}

Keep responses professional, concise, and always focused on profitability.
Remember: ${languageInstruction}
`.trim();
};

function mapStat(stat) {
  return {
    date: stat?.date,
    // Ingresos
    grossRevenue: Number(stat?.grossRevenue) || 0,
    discounts: Number(stat?.discounts) || 0,
    refunds: Number(stat?.refunds) || 0,
    taxes: Number(stat?.taxes) || 0,
    netRevenue: Number(stat?.netRevenue) || 0,
    // Costes
    adSpend: Number(stat?.adSpend) || 0,
    cogs: Number(stat?.cogs) || 0,
    gatewayFees: Number(stat?.gatewayFees) || 0,
    shippingCosts: Number(stat?.shippingCosts) || 0,
    // Métricas calculadas
    netProfit: Number(stat?.netProfit) || 0,
    blendedROAS: Number(stat?.blendedROAS) || 0,
    breakEvenROAS: Number(stat?.breakEvenROAS) || 0,
    contributionMargin: Number(stat?.contributionMargin) || 0,
    confidenceScore: Number(stat?.confidenceScore) || 0,
    dataFlags: Array.isArray(stat?.dataFlags) ? stat.dataFlags : [],
    // Meta snapshot
    metaData: {
      impressions: Number(stat?.metaData?.impressions) || 0,
      clicks: Number(stat?.metaData?.clicks) || 0,
      ctr: Number(stat?.metaData?.ctr) || 0,
      cpc: Number(stat?.metaData?.cpc) || 0,
      campaignsActive: Number(stat?.metaData?.campaignsActive) || 0,
    },
  };
}

function buildBusinessContext(dailyStats, alerts, store) {
  const orderedStats = Array.isArray(dailyStats)
    ? dailyStats.slice(-14).map(mapStat)
    : [];
  const payload = {
    dailyStats: orderedStats,
    alerts: Array.isArray(alerts) ? alerts : [],
    store: {
      currency: store?.currency || "EUR",
      settings: {
        defaultMarginPercent:
          Number(store?.settings?.defaultMarginPercent) || 0,
        executionMode: store?.settings?.executionMode || "COPILOT",
        strategy: store?.settings?.strategy || "BALANCED",
        industry: store?.settings?.industry || "OTHER",
      },
      monthlyGoals: {
        targetRevenue: Number(store?.monthlyGoals?.targetRevenue) || 0,
        targetROAS: Number(store?.monthlyGoals?.targetROAS) || 0,
        targetAdSpend: Number(store?.monthlyGoals?.targetAdSpend) || 0,
      },
    },
  };

  let finalPayload = payload;
if (estimateTokens(payload) > TOKEN_BUDGET.businessContext) {
  finalPayload = { ...payload, dailyStats: orderedStats.slice(-7) };
}
return sanitizeBusinessContext(finalPayload);
}

function trimChatHistory(chatHistory) {
  const history = Array.isArray(chatHistory) ? chatHistory.slice(-10) : [];

  const trimmed = history.map((msg) => ({
    role: msg.role,
    content: safeTrimContent(msg.content, 500),
  }));

  if (estimateTokens(trimmed) <= TOKEN_BUDGET.chatHistory) return trimmed;

  return trimmed.slice(-6);
}

function buildMessagesArray(
  systemPrompt,
  businessContext,
  chatHistory,
  userMessage,
) {
  const safeHistory = trimChatHistory(chatHistory);
  const safeUserMessage = String(userMessage || "").slice(
    0,
    TOKEN_BUDGET.userMessage * 4,
  );

  const messages = [
    {
      role: "system",
      content: `${systemPrompt}\n\nBUSINESS CONTEXT:\n${JSON.stringify(businessContext)}`,
    },
    ...safeHistory,
    { role: "user", content: safeUserMessage },
  ];

  // 🛡️ ÚLTIMA RED DE SEGURIDAD
 if (estimateTokens(messages) > TOKEN_BUDGET.total) {
  // 1. Extraemos el mensaje de sistema
  const systemMessage = messages[0];

  // 2. Separamos las instrucciones de los datos
  const parts = systemMessage.content.split("BUSINESS CONTEXT:\n");
  const promptPart = parts[0];
  let contextPart = parts[1] || "";

  // 3. Recorte agresivo pero controlado
  // Usamos el budget real de businessContext (aprox 4 caracteres por token)
  const maxChars = TOKEN_BUDGET.businessContext * 4;
  
  if (contextPart.length > maxChars) {
    // Cortamos y añadimos un cierre manual para intentar que el JSON sea "menos" traumático
    contextPart = contextPart.slice(0, maxChars) + "\n... [Datos truncados por espacio] } }";
  }

  // 4. Reconstruimos
  messages[0].content = `${promptPart}BUSINESS CONTEXT:\n${contextPart}`;
}

  return messages;
}

export {
  TOKEN_BUDGET,
  estimateTokens,
  buildSystemPrompt,
  buildBusinessContext,
  buildMessagesArray,
};
