function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((acc, value) => acc + value, 0) / values.length;
}

function standardDeviation(values, avg) {
  if (!values.length) return 0;
  const variance = values.reduce((acc, value) => acc + (value - avg) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function clampConfidence(value) {
  return Math.max(0, Math.min(100, value));
}

function percentageDiff(current, baseline) {
  if (!baseline) return 0;
  return ((current - baseline) / Math.abs(baseline)) * 100;
}

function getDirection(change) {
  if (change > 0) return "UP";
  if (change < 0) return "DOWN";
  return "STABLE";
}

function detectAnomaly(metricValues, options = {}) {
  const threshold = Number(options.threshold ?? 15);
  const minWindow = Number(options.minWindow ?? 7);
  const values = (Array.isArray(metricValues) ? metricValues : []).map(safeNumber);

  if (values.length < minWindow) {
    return { type: "INSUFFICIENT_DATA" };
  }

  const avg = mean(values);
  const std = standardDeviation(values, avg);
  const lastValue = values[values.length - 1];
  const change = percentageDiff(lastValue, avg);
  const absChange = Math.abs(change);

  if (absChange < threshold) {
    return { type: "STABLE", confidence: 0, direction: "STABLE", percentageChange: change };
  }

  const direction = getDirection(change);
  const minSignificant = Math.abs(avg) * (threshold / 100);
  const significantDaysFromEnd = [];

  // Validamos continuidad al final de la serie para diferenciar tendencia vs evento aislado.
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const delta = values[i] - avg;
    const sameDirection = direction === "UP" ? delta >= minSignificant : delta <= -minSignificant;
    if (!sameDirection) break;
    significantDaysFromEnd.push(values[i]);
  }

  const zScore = std === 0 ? 0 : Math.abs(lastValue - avg) / std;
  const confidence = clampConfidence(zScore * 20);

  if (significantDaysFromEnd.length >= 2) {
    return { type: "TREND", confidence, direction, percentageChange: change };
  }

  return { type: "ONE_TIME_EVENT", confidence, direction, percentageChange: change };
}

function classifyDrop(recentValues, baselineValues) {
  const recent = (Array.isArray(recentValues) ? recentValues : []).map(safeNumber);
  const baseline = (Array.isArray(baselineValues) ? baselineValues : []).map(safeNumber);

  if (recent.length < 1 || baseline.length < 4) {
    return {
      isAnomaly: false,
      type: "INSUFFICIENT_DATA",
      percentageChange: 0,
      direction: "STABLE",
      confidence: 0,
      recommendation: "Collect more data to complete anomaly classification.",
    };
  }

  const recentAvg = mean(recent);
  const baselineAvg = mean(baseline);
  const change = percentageDiff(recentAvg, baselineAvg);
  const baseDetection = detectAnomaly([...baseline, ...recent], { threshold: 15, minWindow: 7 });
  const type = baseDetection.type || "STABLE";
  const direction = baseDetection.direction || getDirection(change);
  const confidence = clampConfidence(baseDetection.confidence || Math.abs(change));

  if (type === "STABLE") {
    return {
      isAnomaly: false,
      type,
      percentageChange: change,
      direction: "STABLE",
      confidence: 0,
      recommendation: "Metrics are stable. Keep current strategy and monitoring cadence.",
    };
  }

  if (type === "ONE_TIME_EVENT") {
    return {
      isAnomaly: true,
      type,
      percentageChange: change,
      direction,
      confidence,
      recommendation: "Monitor for 2 more days before acting on this isolated movement.",
    };
  }

  if (type === "TREND") {
    return {
      isAnomaly: true,
      type,
      percentageChange: change,
      direction,
      confidence,
      recommendation:
        direction === "DOWN"
          ? "Persistent decline detected. Audit creatives, bidding, and funnel immediately."
          : "Persistent growth detected. Validate capacity before scaling budget.",
    };
  }

  return {
    isAnomaly: false,
    type: "INSUFFICIENT_DATA",
    percentageChange: change,
    direction: "STABLE",
    confidence: 0,
    recommendation: "Collect more data to complete anomaly classification.",
  };
}

function isSeasonalPattern(todayValue, sameWeekdayLastWeekValue, threshold = 10) {
  const today = safeNumber(todayValue);
  const previous = safeNumber(sameWeekdayLastWeekValue);
  const diff = percentageDiff(today, previous);

  return {
    isSeasonal: Math.abs(diff) < Math.abs(Number(threshold)),
    percentageDiff: diff,
  };
}

export { detectAnomaly, classifyDrop, isSeasonalPattern };
