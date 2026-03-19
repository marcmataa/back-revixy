// src/routes/auth.routes.js
import express from "express";
import * as authController from "../controllers/auth.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { validateRegister, validateLogin } from "../middleware/validate.middleware.js";
import { authLimiter, refreshLimiter } from "../middleware/rateLimit.middleware.js";

// ─── RUTAS PÚBLICAS ───────────────────────────────────────────────────────

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

// ─── RUTAS PROTEGIDAS (requieren JWT válido) ──────────────────────────────

// POST /api/auth/logout
router.post("/logout", protect, authController.logout);

// GET /api/auth/me
router.get("/me", protect, authController.getMe);

export default router;