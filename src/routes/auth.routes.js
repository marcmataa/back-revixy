// src/routes/auth.routes.js
import express from "express";
import * as authController from "../controllers/auth.controller.js";
import {
  googleInitiate,
  googleCallback,
  getOAuthToken,
} from "../controllers/auth.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { validateRegister, validateLogin } from "../middleware/validate.middleware.js";
import { authLimiter, refreshLimiter } from "../middleware/rateLimit.middleware.js";

// ─── RUTAS PÚBLICAS ───────────────────────────────────────────────────────
const router = express.Router();
// POST /api/auth/register
router.post(
  "/register",
  authLimiter,
  validateRegister,
  authController.register
);

// POST /api/auth/login
router.post(
  "/login",
  authLimiter,
  validateLogin,
  authController.login
);

// POST /api/auth/refresh
router.post(
  "/refresh",
  refreshLimiter,
  authController.refresh
);

// GET /api/auth/google — inicia el flujo OAuth con Google
router.get("/google", googleInitiate);

// GET /api/auth/google/callback — Google redirige aquí tras autorizar o cancelar
router.get("/google/callback", googleCallback);

// GET /api/auth/token — el frontend intercambia la cookie de handoff por el accessToken
router.get("/token", getOAuthToken);

// ─── RUTAS PROTEGIDAS (requieren JWT válido) ──────────────────────────────

// POST /api/auth/logout
router.post("/logout", protect, authController.logout);

// GET /api/auth/me
router.get("/me", protect, authController.getMe);

export default router;