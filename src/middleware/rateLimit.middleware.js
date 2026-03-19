// src/middleware/rateLimit.middleware.js
const rateLimit = require("express-rate-limit");

/**
 * Rate limiter global para todas las rutas de la API
 */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Demasiadas peticiones. Intenta de nuevo en 15 minutos",
  },
});

/**
 * Rate limiter estricto para login/register (anti-brute force)
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 10, // máximo 10 intentos de login
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // No contar requests exitosos
  message: {
    success: false,
    message: "Demasiados intentos de autenticación. Intenta en 15 minutos",
  },
});

/**
 * Rate limiter para refresh token
 */
const refreshLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 5,
  message: {
    success: false,
    message: "Demasiadas peticiones de refresh. Espera un momento",
  },
});

module.exports = { globalLimiter, authLimiter, refreshLimiter };