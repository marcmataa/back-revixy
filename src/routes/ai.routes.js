import express from "express";
import rateLimit from "express-rate-limit";
import { protect } from "../middleware/auth.middleware.js";
import { storeOwnership } from "../middleware/storeOwnership.middleware.js";
import {
  getInsight,
  chat,
  simulate,
  deleteSession,
} from "../controllers/ai.controller.js";

const router = express.Router();

// Aplicamos un límite específico por costo alto de llamadas AI.
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "Too many AI requests, please try again later" },
});

router.post("/insight", aiLimiter, protect, storeOwnership, getInsight);
router.post("/chat", aiLimiter, protect, storeOwnership, chat);
router.post("/simulate", aiLimiter, protect, storeOwnership, simulate);
router.delete("/session/:sessionId", aiLimiter, protect, storeOwnership, deleteSession);

export default router;
