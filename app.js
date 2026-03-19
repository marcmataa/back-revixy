// app.js
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { globalLimiter } from "./src/middleware/rateLimit.middleware.js";
import authRoutes from "./src/routes/auth.routes.js";

const app = express();

// ─── CORS ─────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      // Permitir requests sin origin (Postman, mobile apps, etc.)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS bloqueado para origen: ${origin}`));
      }
    },
    credentials: true, // Necesario para enviar cookies
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ─── SEGURIDAD ────────────────────────────────────────────────────────────
// Ocultar que usamos Express
app.disable("x-powered-by");

// Headers de seguridad básicos (en producción usa helmet)
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

// ─── PARSERS ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10kb" }));        // Limitar tamaño del body
app.use(express.urlencoded({ extended: true, limit: "10kb" }));
app.use(cookieParser());

// ─── RATE LIMITING GLOBAL ─────────────────────────────────────────────────
app.use("/api", globalLimiter);

// ─── RUTAS ────────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────
app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "API funcionando correctamente",
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV,
  });
});

// ─── RUTA NO ENCONTRADA ───────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Ruta ${req.originalUrl} no encontrada`,
  });
});

// ─── MANEJADOR GLOBAL DE ERRORES ──────────────────────────────────────────
app.use((err, req, res, next) => {
  // Error de CORS
  if (err.message && err.message.startsWith("CORS bloqueado")) {
    return res.status(403).json({ success: false, message: err.message });
  }

  console.error("💥 Error no controlado:", err);
  res.status(err.status || 500).json({
    success: false,
    message:
      process.env.NODE_ENV === "production"
        ? "Error interno del servidor"
        : err.message,
  });
});

export default app;