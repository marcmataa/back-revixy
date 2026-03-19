import ActionLogs from "../models/ActionLogs.model.js";
import DailyStats from "../models/DailyStats.model.js";
import { fetchOrders } from "./shopify.service.js";
import { fetchCampaignInsights } from "./metaAds.service.js";
import { mapShopifyOrders, mapMetaInsights, applyFallbacks } from "./dataMapping.service.js";
import {
  calculateNetRevenue,
  calculateNetProfit,
  calculateBlendedROAS,
  calculateBreakEvenROAS,
  calculateContributionMargin,
  calculateConfidenceScore,
  calculateDataFlags,
} from "./statsCalculator.service.js";

const CALCULATION_VERSION = "v1.0";
const LOOKBACK_DAYS = 7;

function formatDateISO(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function buildLookbackWindow(days) {
  const result = [];
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);

  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(end);
    day.setUTCDate(end.getUTCDate() - i);
    result.push(formatDateISO(day));
  }

  return result;
}

function maskStoreId(storeId) {
  return String(storeId || "").slice(0, 8);
}

function mergeFlags(...flagLists) {
  return [...new Set(flagLists.flat().filter(Boolean))];
}

async function runForStore(store) {
  const startedAt = Date.now();
  const storeId = store?._id;
  const dateWindow = buildLookbackWindow(LOOKBACK_DAYS);
  const metadata = {
    daysProcessed: 0,
    storeId: maskStoreId(storeId),
    calculationVersion: CALCULATION_VERSION,
  };

  try {
    // Ejecutamos extracción de Shopify y Meta por separado para aislar fallos parciales.
    let shopifyOrders = [];
    let metaInsights = [];
    let hasShopifyData = false;
    let hasMetaData = false;
    const extractionFlags = [];

    const fromDate = dateWindow[0];
    const toDate = dateWindow[dateWindow.length - 1];

    try {
      const shopifyResult = await fetchOrders(store, {
        created_at_min: `${fromDate}T00:00:00Z`,
        created_at_max: `${toDate}T23:59:59Z`,
        status: "any",
        limit: 250,
      });
      if (shopifyResult?.success) {
        shopifyOrders = shopifyResult?.data?.orders || [];
        hasShopifyData = true;
      } else {
        extractionFlags.push("LOW_CONFIDENCE");
      }
    } catch (error) {
      extractionFlags.push("LOW_CONFIDENCE");
      await ActionLogs.create({
        storeId,
        type: "ETL_SYNC",
        status: "FAIL",
        message: "Shopify extraction failed during ETL sync",
        metadata: { storeId: maskStoreId(storeId), error: error.message },
      });
    }

    try {
      const metaResult = await fetchCampaignInsights(store, {
        since: fromDate,
        until: toDate,
      });
      if (metaResult?.success) {
        metaInsights = metaResult?.data?.insights || [];
        hasMetaData = true;
      } else {
        extractionFlags.push("LOW_CONFIDENCE");
      }
    } catch (error) {
      extractionFlags.push("LOW_CONFIDENCE");
      await ActionLogs.create({
        storeId,
        type: "ETL_SYNC",
        status: "FAIL",
        message: "Meta extraction failed during ETL sync",
        metadata: { storeId: maskStoreId(storeId), error: error.message },
      });
    }

    const mappedShopifyByDate = new Map(mapShopifyOrders(shopifyOrders, store).map((item) => [item.date, item]));
    const mappedMetaByDate = new Map(mapMetaInsights(metaInsights).map((item) => [item.date, item]));

    // Calculamos promedio CPC sobre la ventana para detección de HIGH_CPC.
    const cpcValues = [...mappedMetaByDate.values()].map((entry) => Number(entry.cpc) || 0).filter((cpc) => cpc > 0);
    const cpc7DayAverage =
      cpcValues.length > 0 ? cpcValues.reduce((acc, value) => acc + value, 0) / cpcValues.length : 0;

    for (const date of dateWindow) {
      try {
        const shopifyDay = mappedShopifyByDate.get(date) || {
          date,
          grossRevenue: 0,
          discounts: 0,
          refunds: 0,
          taxes: 0,
          orderCount: 0,
          dataFlags: [],
        };
        const metaDay = mappedMetaByDate.get(date) || {
          date,
          adSpend: 0,
          impressions: 0,
          clicks: 0,
          ctr: 0,
          cpc: 0,
          campaignsActive: 0,
          dataFlags: [],
        };

        if (shopifyDay.grossRevenue < 0 || metaDay.adSpend < 0) {
          // Saltamos registros inválidos para evitar persistencia de datos corruptos.
          continue;
        }

        const merged = applyFallbacks(
          {
            date,
            grossRevenue: shopifyDay.grossRevenue,
            discounts: shopifyDay.discounts,
            refunds: shopifyDay.refunds,
            taxes: shopifyDay.taxes,
            orderCount: shopifyDay.orderCount,
            adSpend: metaDay.adSpend,
            impressions: metaDay.impressions,
            clicks: metaDay.clicks,
            ctr: metaDay.ctr,
            cpc: metaDay.cpc,
            campaignsActive: metaDay.campaignsActive,
            dataFlags: mergeFlags(shopifyDay.dataFlags, metaDay.dataFlags, extractionFlags),
          },
          store
        );

        const breakEvenROAS = calculateBreakEvenROAS(store?.settings?.defaultMarginPercent ?? 0);
        const netRevenueResult = calculateNetRevenue(merged);
        const netProfitResult = calculateNetProfit({
          netRevenue: netRevenueResult.value,
          adSpend: merged.adSpend,
          cogs: merged.cogs,
          gatewayFees: merged.gatewayFees,
          shippingCosts: merged.shippingCosts,
        });
        const blendedROASResult = calculateBlendedROAS({
          grossRevenue: merged.grossRevenue,
          adSpend: merged.adSpend,
          breakEvenROAS,
        });

        const confidenceScore = calculateConfidenceScore({
          hasShopifyData,
          hasMetaData,
          hasGA4Data: false,
          divergencePercent: 0,
        });

        const contributionMargin = calculateContributionMargin({
          netProfit: netProfitResult.value,
          netRevenue: netRevenueResult.value,
        });

        const computedFlags = calculateDataFlags({
          netProfit: netProfitResult.value,
          blendedROAS: blendedROASResult.value,
          breakEvenROAS,
          confidenceScore,
          metaData: { cpc: merged.cpc },
          cpc7DayAverage,
          stockRisk: false,
        });

        const dataFlags = mergeFlags(
          merged.dataFlags,
          netRevenueResult.flags,
          netProfitResult.flags,
          blendedROASResult.flags,
          computedFlags
        );

        await DailyStats.updateOne(
          { storeId, date },
          {
            $set: {
              storeId,
              date,
              calculationVersion: CALCULATION_VERSION,
              grossRevenue: merged.grossRevenue,
              discounts: merged.discounts,
              refunds: merged.refunds,
              adSpend: merged.adSpend,
              cogs: merged.cogs,
              gatewayFees: merged.gatewayFees,
              shippingCosts: merged.shippingCosts,
              taxes: merged.taxes,
              netRevenue: netRevenueResult.value,
              netProfit: netProfitResult.value,
              blendedROAS: blendedROASResult.value,
              breakEvenROAS,
              contributionMargin,
              confidenceScore,
              dataFlags,
              metaData: {
                impressions: merged.impressions,
                clicks: merged.clicks,
                ctr: merged.ctr,
                cpc: merged.cpc,
                campaignsActive: merged.campaignsActive,
              },
            },
          },
          { upsert: true }
        );

        metadata.daysProcessed += 1;
      } catch (error) {
        // Aislamos fallos por día para no abortar la ventana completa.
        await ActionLogs.create({
          storeId,
          type: "ETL_SYNC",
          status: "FAIL",
          message: `Daily upsert failed for ${date}`,
          metadata: { storeId: maskStoreId(storeId), date, error: error.message },
        });
      }
    }

    await ActionLogs.create({
      storeId,
      type: "ETL_SYNC",
      status: "SUCCESS",
      message: "ETL sync completed",
      duration: Date.now() - startedAt,
      metadata,
    });

    return {
      success: true,
      daysProcessed: metadata.daysProcessed,
      calculationVersion: CALCULATION_VERSION,
    };
  } catch (error) {
    await ActionLogs.create({
      storeId,
      type: "ETL_SYNC",
      status: "FAIL",
      message: "ETL sync failed",
      duration: Date.now() - startedAt,
      metadata: { ...metadata, error: error.message },
    });

    return { success: false, error: error.message };
  }
}

export { runForStore };
