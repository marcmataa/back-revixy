function parseMoneyToCents(value) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return { value: 0, lowConfidence: true };
  }

  const cents = Math.round(parsed * 100);
  if (cents < 0) {
    return { value: 0, rejected: true };
  }

  return { value: cents, lowConfidence: false };
}

function parseInteger(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return { value: 0, lowConfidence: true };
  }

  if (parsed < 0) {
    return { value: 0, rejected: true };
  }

  return { value: parsed, lowConfidence: false };
}

function parseFloatMetric(value) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return { value: 0, lowConfidence: true };
  }

  if (parsed < 0) {
    return { value: 0, rejected: true };
  }

  return { value: parsed, lowConfidence: false };
}

function formatDateInTimezone(inputDate, timezone) {
  const date = new Date(inputDate);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(date);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }
}

function appendLowConfidence(flags) {
  if (!flags.includes("LOW_CONFIDENCE")) {
    flags.push("LOW_CONFIDENCE");
  }
}

function mapShopifyOrders(orders = [], store = {}) {
  const timezone = store?.timezone || "UTC";
  const allowedStatuses = new Set(["paid", "partially_refunded"]);
  const grouped = new Map();

  for (const order of Array.isArray(orders) ? orders : []) {
    const status = String(order?.financial_status || "").toLowerCase();
    if (!allowedStatuses.has(status)) continue;

    const dayKey = formatDateInTimezone(order?.created_at, timezone);
    if (!dayKey) continue;

    if (!grouped.has(dayKey)) {
      grouped.set(dayKey, {
        date: dayKey,
        grossRevenue: 0,
        discounts: 0,
        refunds: 0,
        orderCount: 0,
        taxes: 0,
        dataFlags: [],
      });
    }

    const current = grouped.get(dayKey);

    const gross = parseMoneyToCents(order?.total_price);
    const discounts = parseMoneyToCents(order?.total_discounts);
    const taxes = parseMoneyToCents(order?.total_tax);
    const refunds = parseMoneyToCents(order?.total_refunded_set?.shop_money?.amount ?? order?.total_refunded);

    if (gross.lowConfidence || discounts.lowConfidence || taxes.lowConfidence || refunds.lowConfidence) {
      appendLowConfidence(current.dataFlags);
    }

    if (gross.rejected || discounts.rejected || taxes.rejected || refunds.rejected) {
      continue;
    }

    current.grossRevenue += gross.value;
    current.discounts += discounts.value;
    current.refunds += refunds.value;
    current.taxes += taxes.value;
    current.orderCount += 1;
  }

  return [...grouped.values()].filter((record) => record.grossRevenue >= 0);
}

function mapMetaInsights(insights = []) {
  const grouped = new Map();

  for (const insight of Array.isArray(insights) ? insights : []) {
    const dayKey = insight?.date_start || insight?.date_stop;
    if (!dayKey) continue;

    if (!grouped.has(dayKey)) {
      grouped.set(dayKey, {
        date: dayKey,
        adSpend: 0,
        impressions: 0,
        clicks: 0,
        ctrWeightedSum: 0,
        cpcWeightedSum: 0,
        weightedImpressions: 0,
        campaignsActive: 0,
        dataFlags: [],
      });
    }

    const current = grouped.get(dayKey);
    const spend = parseMoneyToCents(insight?.spend);
    const impressions = parseInteger(insight?.impressions);
    const clicks = parseInteger(insight?.clicks);
    const ctr = parseFloatMetric(insight?.ctr);
    const cpc = parseFloatMetric(insight?.cpc);

    if (spend.lowConfidence || impressions.lowConfidence || clicks.lowConfidence || ctr.lowConfidence || cpc.lowConfidence) {
      appendLowConfidence(current.dataFlags);
    }

    if (spend.rejected || impressions.rejected || clicks.rejected || ctr.rejected || cpc.rejected) {
      continue;
    }

    current.adSpend += spend.value;
    current.impressions += impressions.value;
    current.clicks += clicks.value;
    current.ctrWeightedSum += ctr.value * impressions.value;
    current.cpcWeightedSum += cpc.value * impressions.value;
    current.weightedImpressions += impressions.value;
    current.campaignsActive += 1;
  }

  return [...grouped.values()]
    .filter((record) => record.adSpend >= 0)
    .map((record) => ({
      date: record.date,
      adSpend: record.adSpend,
      impressions: record.impressions,
      clicks: record.clicks,
      ctr: record.weightedImpressions > 0 ? record.ctrWeightedSum / record.weightedImpressions : 0,
      cpc: record.weightedImpressions > 0 ? record.cpcWeightedSum / record.weightedImpressions : 0,
      campaignsActive: record.campaignsActive,
      dataFlags: record.dataFlags,
    }));
}

function applyFallbacks(mappedData = {}, store = {}) {
  const settings = store?.settings || {};
  const flags = [...(mappedData?.dataFlags || [])];
  const next = { ...mappedData };

  const marginPercent = Number(settings.defaultMarginPercent) || 0;
  const gatewayFeePercent = Number(settings.defaultGatewayFeePercent) || 0;
  const gatewayFeeFixed = Number.isFinite(Number(settings.defaultGatewayFeeFixed))
    ? Math.round(Number(settings.defaultGatewayFeeFixed))
    : 0;
  const defaultShippingCost = Number.isFinite(Number(settings.defaultShippingCost))
    ? Math.round(Number(settings.defaultShippingCost))
    : 0;

  if (!Number.isInteger(next.cogs)) {
    next.cogs = Math.round((Number(next.grossRevenue || 0) * (100 - marginPercent)) / 100);
    appendLowConfidence(flags);
  }

  if (!Number.isInteger(next.gatewayFees)) {
    next.gatewayFees = Math.round((Number(next.grossRevenue || 0) * gatewayFeePercent) / 100) + gatewayFeeFixed;
    appendLowConfidence(flags);
  }

  if (!Number.isInteger(next.shippingCosts)) {
    next.shippingCosts = defaultShippingCost;
    appendLowConfidence(flags);
  }

  next.cogs = Math.max(0, Math.round(Number(next.cogs || 0)));
  next.gatewayFees = Math.max(0, Math.round(Number(next.gatewayFees || 0)));
  next.shippingCosts = Math.max(0, Math.round(Number(next.shippingCosts || 0)));
  next.grossRevenue = Math.max(0, Math.round(Number(next.grossRevenue || 0)));
  next.adSpend = Math.max(0, Math.round(Number(next.adSpend || 0)));
  next.discounts = Math.max(0, Math.round(Number(next.discounts || 0)));
  next.refunds = Math.max(0, Math.round(Number(next.refunds || 0)));
  next.taxes = Math.max(0, Math.round(Number(next.taxes || 0)));
  next.orderCount = Math.max(0, Math.round(Number(next.orderCount || 0)));

  next.dataFlags = [...new Set(flags)];
  return next;
}

export { mapShopifyOrders, mapMetaInsights, applyFallbacks };
