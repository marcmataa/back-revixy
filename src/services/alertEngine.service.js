import crypto from "crypto";
import DailyStats from "../models/DailyStats.model.js";

const SEVERITY_RANK = { CRITICAL: 3, WARNING: 2, OPPORTUNITY: 1 };

function average(values) {
  if (!values.length) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function safeNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function buildTrend(current, baseline) {
  if (current > baseline) return "UP";
  if (current < baseline) return "DOWN";
  return "STABLE";
}

function consecutiveDays(stats, conditionFn) {
  let count = 0;
  for (const day of stats) {
    if (!conditionFn(day)) break;
    count += 1;
  }
  return count;
}

function mapAlert({
  storeId,
  type,
  severity,
  title,
  message,
  affectedMetric,
  currentValue,
  averageValue,
  consecutiveDayCount,
}) {
  return {
    alertId: crypto.randomUUID(),
    storeId,
    type,
    severity,
    title: title.slice(0, 60),
    message: message.slice(0, 200),
    affectedMetric,
    currentValue,
    averageValue,
    trend: buildTrend(currentValue, averageValue),
    consecutiveDays: consecutiveDayCount,
    detectedAt: new Date(),
    requiresAction: severity === "CRITICAL",
  };
}

function getMetric(day, key) {
  if (key === "ctr" || key === "cpc") return safeNumber(day?.metaData?.[key]);
  return safeNumber(day?.[key]);
}

function buildAverages(recentStats) {
  const seven = recentStats.slice(0, 7);
  return {
    blendedROAS: average(seven.map((item) => getMetric(item, "blendedROAS"))),
    netProfit: average(seven.map((item) => getMetric(item, "netProfit"))),
    adSpend: average(seven.map((item) => getMetric(item, "adSpend"))),
    ctr: average(seven.map((item) => getMetric(item, "ctr"))),
    cpc: average(seven.map((item) => getMetric(item, "cpc"))),
    grossRevenue: average(seven.map((item) => getMetric(item, "grossRevenue"))),
    contributionMargin: average(seven.map((item) => getMetric(item, "contributionMargin"))),
  };
}

function roasDecliningFiveDay(stats) {
  if (stats.length < 5) return false;
  const values = stats.slice(0, 5).map((item) => getMetric(item, "blendedROAS"));
  const oldest = values[4];
  const newest = values[0];
  if (oldest <= 0) return false;
  const change = ((newest - oldest) / Math.abs(oldest)) * 100;
  return change <= -10;
}

async function generateAlertsForStore(storeId) {
  const recentStats = await DailyStats.find({ storeId })
    .sort({ date: -1 })
    .limit(14)
    .select("storeId date grossRevenue netProfit adSpend blendedROAS breakEvenROAS contributionMargin metaData")
    .lean();

  if (recentStats.length < 7) {
    // Evitamos decisiones impulsivas con menos de 7 días.
    return { alerts: [], reason: "INSUFFICIENT_DATA" };
  }

  const [today] = recentStats;
  const averages = buildAverages(recentStats);
  const alerts = [];

  const roasBelowDays = consecutiveDays(
    recentStats,
    (item) => getMetric(item, "blendedROAS") < safeNumber(item.breakEvenROAS)
  );
  if (roasBelowDays >= 3) {
    alerts.push(
      mapAlert({
        storeId,
        type: "ROAS_BELOW_BREAKEVEN",
        severity: "CRITICAL",
        title: "ROAS below break-even threshold",
        message: `ROAS is ${getMetric(today, "blendedROAS").toFixed(2)} vs break-even ${safeNumber(today.breakEvenROAS).toFixed(2)} for ${roasBelowDays} days.`,
        affectedMetric: "blendedROAS",
        currentValue: getMetric(today, "blendedROAS"),
        averageValue: averages.blendedROAS,
        consecutiveDayCount: roasBelowDays,
      })
    );
  }

  const negativeProfitDays = consecutiveDays(recentStats, (item) => getMetric(item, "netProfit") < 0);
  if (negativeProfitDays >= 2) {
    alerts.push(
      mapAlert({
        storeId,
        type: "PROFIT_NEGATIVE",
        severity: "CRITICAL",
        title: "Net profit is negative",
        message: `Net profit is ${getMetric(today, "netProfit")} cents and has stayed negative for ${negativeProfitDays} days.`,
        affectedMetric: "netProfit",
        currentValue: getMetric(today, "netProfit"),
        averageValue: averages.netProfit,
        consecutiveDayCount: negativeProfitDays,
      })
    );
  }

  const revenueDropDays = consecutiveDays(
    recentStats,
    (item) => getMetric(item, "grossRevenue") < averages.grossRevenue * 0.85
  );
  if (revenueDropDays >= 2) {
    alerts.push(
      mapAlert({
        storeId,
        type: "REVENUE_DROP",
        severity: "CRITICAL",
        title: "Revenue dropped vs weekly baseline",
        message: `Revenue ${getMetric(today, "grossRevenue")} cents is >15% below 7-day avg ${averages.grossRevenue.toFixed(0)} for ${revenueDropDays} days.`,
        affectedMetric: "grossRevenue",
        currentValue: getMetric(today, "grossRevenue"),
        averageValue: averages.grossRevenue,
        consecutiveDayCount: revenueDropDays,
      })
    );
  }

  if (getMetric(today, "ctr") < averages.ctr * 0.8) {
    alerts.push(
      mapAlert({
        storeId,
        type: "CTR_DECLINING",
        severity: "WARNING",
        title: "CTR is declining",
        message: `CTR ${getMetric(today, "ctr").toFixed(4)} is down more than 20% vs 7-day avg ${averages.ctr.toFixed(4)}.`,
        affectedMetric: "ctr",
        currentValue: getMetric(today, "ctr"),
        averageValue: averages.ctr,
        consecutiveDayCount: consecutiveDays(recentStats, (item) => getMetric(item, "ctr") < averages.ctr * 0.8),
      })
    );
  }

  if (averages.cpc > 0 && getMetric(today, "cpc") > averages.cpc * 1.2) {
    alerts.push(
      mapAlert({
        storeId,
        type: "CPC_SPIKE",
        severity: "WARNING",
        title: "CPC spike detected",
        message: `CPC ${getMetric(today, "cpc").toFixed(4)} is over 20% above weekly avg ${averages.cpc.toFixed(4)}.`,
        affectedMetric: "cpc",
        currentValue: getMetric(today, "cpc"),
        averageValue: averages.cpc,
        consecutiveDayCount: consecutiveDays(recentStats, (item) => getMetric(item, "cpc") > averages.cpc * 1.2),
      })
    );
  }

  if (roasDecliningFiveDay(recentStats)) {
    alerts.push(
      mapAlert({
        storeId,
        type: "ROAS_DECLINING",
        severity: "WARNING",
        title: "ROAS trending down",
        message: "ROAS trend declined more than 10% over the last 5 days.",
        affectedMetric: "blendedROAS",
        currentValue: getMetric(today, "blendedROAS"),
        averageValue: averages.blendedROAS,
        consecutiveDayCount: 5,
      })
    );
  }

  if (
    getMetric(today, "blendedROAS") > safeNumber(today.breakEvenROAS) * 1.5 &&
    getMetric(today, "adSpend") < averages.adSpend
  ) {
    alerts.push(
      mapAlert({
        storeId,
        type: "SCALE_OPPORTUNITY",
        severity: "OPPORTUNITY",
        title: "Scale opportunity detected",
        message: `ROAS ${getMetric(today, "blendedROAS").toFixed(2)} is strong while ad spend ${getMetric(today, "adSpend")} is below average ${averages.adSpend.toFixed(0)}.`,
        affectedMetric: "adSpend",
        currentValue: getMetric(today, "adSpend"),
        averageValue: averages.adSpend,
        consecutiveDayCount: 1,
      })
    );
  }

  const highMarginDays = consecutiveDays(recentStats, (item) => getMetric(item, "contributionMargin") > 40);
  if (highMarginDays >= 2) {
    alerts.push(
      mapAlert({
        storeId,
        type: "HIGH_MARGIN_DAY",
        severity: "OPPORTUNITY",
        title: "High margin streak",
        message: `Contribution margin ${getMetric(today, "contributionMargin").toFixed(2)}% is above 40% for ${highMarginDays} days.`,
        affectedMetric: "contributionMargin",
        currentValue: getMetric(today, "contributionMargin"),
        averageValue: averages.contributionMargin,
        consecutiveDayCount: highMarginDays,
      })
    );
  }

  alerts.sort((a, b) => {
    const severityDelta = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (severityDelta !== 0) return severityDelta;
    return b.consecutiveDays - a.consecutiveDays;
  });

  return { alerts };
}

export { generateAlertsForStore };
