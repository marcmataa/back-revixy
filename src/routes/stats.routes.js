import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import { storeOwnership } from "../middleware/storeOwnership.middleware.js";
import {
  getDashboardStats,
  getAlerts,
  getAnomalyReport,
  getDailyStats,
} from "../controllers/stats.controller.js";

const router = express.Router();

router.get("/dashboard", protect, storeOwnership, getDashboardStats);
router.get("/alerts", protect, storeOwnership, getAlerts);
router.get("/anomaly", protect, storeOwnership, getAnomalyReport);
router.get("/daily", protect, storeOwnership, getDailyStats);

export default router;
