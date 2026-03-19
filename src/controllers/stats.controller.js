import DailyStats from "../models/DailyStats.model.js";
import { generateAlertsForStore } from "../services/alertEngine.service.js";
import { classifyDrop } from "../services/anomalyDetector.service.js";
import { notifyIfCritical } from "../services/notification.service.js";

function toDayBounds(dateString, end = false) {
  const date = new Date(`${dateString}T00:00:00.000Z`);
  if (end) date.setUTCHours(23, 59, 59, 999);
  return date;
}

function normalizeRange(from, to, maxDays = 90) {
  const end = to ? toDayBounds(to, true) : new Date();
  const start = from
    ? toDayBounds(from)
    : new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  if (start > end) throw new Error("Invalid date range: from must be <= to");
  const diffDays =
    Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (diffDays > maxDays) throw new Error("Date range cannot exceed 90 days");
  return { start, end };
}

function parsePagination(page, limit) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 30));
  return { skip: (safePage - 1) * safeLimit, limit: safeLimit, page: safePage };
}

function weightedRoas(stats) {
  const totals = stats.reduce(
    (acc, day) => ({
      grossRevenue: acc.grossRevenue + (Number(day.grossRevenue) || 0),
      adSpend: acc.adSpend + (Number(day.adSpend) || 0),
    }),
    { grossRevenue: 0, adSpend: 0 },
  );
  return totals.adSpend > 0 ? totals.grossRevenue / totals.adSpend : 0;
}

const getDashboardStats = async (req, res) => {
  try {
    const storeId = req.store._id;
    const to = new Date();
    const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);
    const dailyStats = await DailyStats.find({
      storeId,
      date: { $gte: from, $lte: to },
    })
      .sort({ date: -1 })
      .lean();
    const totals = dailyStats.reduce(
      (acc, day) => ({
        totalRevenue: acc.totalRevenue + (Number(day.netRevenue) || 0),
        totalProfit: acc.totalProfit + (Number(day.netProfit) || 0),
        totalAdSpend: acc.totalAdSpend + (Number(day.adSpend) || 0),
        contributionMargin:
          acc.contributionMargin + (Number(day.contributionMargin) || 0),
        confidenceScore:
          acc.confidenceScore + (Number(day.confidenceScore) || 0),
      }),
      {
        totalRevenue: 0,
        totalProfit: 0,
        totalAdSpend: 0,
        contributionMargin: 0,
        confidenceScore: 0,
      },
    );
    const count = dailyStats.length || 1;
    return res
      .status(200)
      .json({
        success: true,
        data: {
          totalRevenue: totals.totalRevenue,
          totalProfit: totals.totalProfit,
          totalAdSpend: totals.totalAdSpend,
          blendedROAS: weightedRoas(dailyStats),
          contributionMargin: totals.contributionMargin / count,
          confidenceScore: totals.confidenceScore / count,
          dailyStats,
          period: { from, to },
        },
      });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const getAlerts = async (req, res) => {
  try {
    const storeId = req.store._id;
    const result = await generateAlertsForStore(storeId);
    const alerts = result.alerts || [];
    notifyIfCritical({ storeId, userId: req.user.id, alerts }).catch(
      (error) => {
        console.error("Notification failed silently:", error.message);
      },
    );
    return res
      .status(200)
      .json({
        success: true,
        data: {
          alerts,
          count: alerts.length,
          hasCritical: alerts.some((alert) => alert.severity === "CRITICAL"),
          reason: result.reason || null,
        },
      });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const getAnomalyReport = async (req, res) => {
  try {
    const storeId = req.store._id;
    const metric = req.query.metric;
    if (!metric)
      return res
        .status(400)
        .json({ success: false, error: "metric query param is required" });
    const allowed = {
      blendedROAS: "blendedROAS",
      netProfit: "netProfit",
      adSpend: "adSpend",
      ctr: "metaData.ctr",
      cpc: "metaData.cpc",
    };
    if (!allowed[metric])
      return res
        .status(400)
        .json({ success: false, error: "Unsupported metric" });
    const dailyStats = await DailyStats.find({ storeId })
      .sort({ date: -1 })
      .limit(14)
      .select(`${allowed[metric]} date`)
      .lean();
    const ordered = [...dailyStats]
      .reverse()
      .map((day) =>
        metric === "ctr" || metric === "cpc"
          ? Number(day.metaData?.[metric]) || 0
          : Number(day[metric]) || 0,
      );
    const result = classifyDrop(ordered.slice(-3), ordered.slice(0, -3));
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const getDailyStats = async (req, res) => {
  try {
    const storeId = req.store._id;
    const { from, to, page, limit } = req.query;
    const { start, end } = normalizeRange(from, to);
    const {
      skip,
      limit: pageLimit,
      page: currentPage,
    } = parsePagination(page, limit);
    const query = { storeId, date: { $gte: start, $lte: end } };
    const [dailyStats, total] = await Promise.all([
      DailyStats.find(query)
        .sort({ date: -1 })
        .skip(skip)
        .limit(pageLimit)
        .lean(),
      DailyStats.countDocuments(query),
    ]);
    return res
      .status(200)
      .json({
        success: true,
        data: {
          dailyStats,
          pagination: {
            page: currentPage,
            limit: pageLimit,
            total,
            totalPages: Math.ceil(total / pageLimit),
          },
          period: { from: start, to: end },
        },
      });
  } catch (error) {
    return res.status(400).json({ success: false, error: error.message });
  }
};

export { getDashboardStats, getAlerts, getAnomalyReport, getDailyStats };
