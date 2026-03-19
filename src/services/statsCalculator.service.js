function normalizeInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed);
}

function normalizeFloat(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
}

function calculateNetRevenue({ grossRevenue = 0, discounts = 0, refunds = 0, taxes = 0 }) {
  const revenue = normalizeInteger(grossRevenue);
  const discountAmount = normalizeInteger(discounts);
  const refundAmount = normalizeInteger(refunds);
  const taxAmount = normalizeInteger(taxes);
  const netRevenue = revenue - discountAmount - refundAmount - taxAmount;

  if (netRevenue < 0) {
    return { value: 0, flags: ["PROFIT_NEGATIVE"] };
  }

  return { value: netRevenue, flags: [] };
}

function calculateNetProfit({ netRevenue = 0, adSpend = 0, cogs = 0, gatewayFees = 0, shippingCosts = 0 }) {
  const profit =
    normalizeInteger(netRevenue) -
    (normalizeInteger(adSpend) +
      normalizeInteger(cogs) +
      normalizeInteger(gatewayFees) +
      normalizeInteger(shippingCosts));

  if (profit < 0) {
    return { value: profit, flags: ["PROFIT_NEGATIVE"] };
  }

  return { value: profit, flags: [] };
}

function calculateBlendedROAS({ grossRevenue = 0, adSpend = 0, breakEvenROAS = null }) {
  const spend = normalizeInteger(adSpend);
  if (spend === 0) {
    return { value: null, flags: [] };
  }

  const roas = normalizeInteger(grossRevenue) / spend;
  const flags = [];
  if (breakEvenROAS !== null && Number.isFinite(Number(breakEvenROAS)) && roas < Number(breakEvenROAS)) {
    flags.push("LOW_ROAS");
  }

  return { value: roas, flags };
}

function calculateBreakEvenROAS(marginPercent = 0) {
  const margin = normalizeFloat(marginPercent);
  if (margin === 0) return null;
  return 1 / (margin / 100);
}

function calculateContributionMargin({ netProfit = 0, netRevenue = 0 }) {
  const revenue = normalizeInteger(netRevenue);
  if (revenue === 0) return null;
  return (normalizeInteger(netProfit) / revenue) * 100;
}

function calculateConfidenceScore({
  hasShopifyData = false,
  hasMetaData = false,
  hasGA4Data = false,
  divergencePercent = 0,
}) {
  let score = 100;

  if (!hasShopifyData) score -= 50;
  if (!hasMetaData) score -= 30;
  if (!hasGA4Data) score -= 10;

  const divergence = normalizeFloat(divergencePercent);
  if (divergence > 40) {
    score -= 40;
  } else if (divergence > 20) {
    score -= 20;
  }

  return Math.max(0, score);
}

function calculateDataFlags({
  netProfit = 0,
  blendedROAS = null,
  breakEvenROAS = null,
  confidenceScore = 100,
  metaData = {},
  cpc7DayAverage = 0,
  stockRisk = false,
}) {
  const flags = new Set();

  if (normalizeInteger(netProfit) < 0) {
    flags.add("PROFIT_NEGATIVE");
  }

  if (
    blendedROAS !== null &&
    breakEvenROAS !== null &&
    Number.isFinite(Number(blendedROAS)) &&
    Number.isFinite(Number(breakEvenROAS)) &&
    Number(blendedROAS) < Number(breakEvenROAS)
  ) {
    flags.add("LOW_ROAS");
  }

  const currentCpc = normalizeFloat(metaData?.cpc);
  const averageCpc = normalizeFloat(cpc7DayAverage);
  if (averageCpc > 0 && currentCpc > averageCpc * 1.2) {
    flags.add("HIGH_CPC");
  }

  if (normalizeInteger(confidenceScore) < 60) {
    flags.add("LOW_CONFIDENCE");
  }

  if (Boolean(stockRisk)) {
    flags.add("STOCK_RISK");
  }

  return [...flags];
}

export {
  calculateNetRevenue,
  calculateNetProfit,
  calculateBlendedROAS,
  calculateBreakEvenROAS,
  calculateContributionMargin,
  calculateConfidenceScore,
  calculateDataFlags,
};
