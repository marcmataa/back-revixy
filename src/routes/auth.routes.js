// src/routes/auth.routes.js
const express = require("express");
const router = express.Router();

const authController = require("../controllers/auth.controller");
const { protect } = require("../middleware/auth.middleware");
const { validateRegister, validateLogin } = require("../middleware/validate.middleware");
const { authLimiter, refreshLimiter } = require("../middleware/rateLimit.middleware");

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

module.exports = router;