// src/controllers/auth.controller.js
import * as authService from "../services/auth.service.js";
import passport from "../config/passport.config.js";
import crypto from "crypto";

// ─── OPCIONES DE COOKIE ───────────────────────────────────────────────────
const cookieOptions = {
  httpOnly: true,             // No accesible desde JS del cliente
  secure: process.env.NODE_ENV === "production", // Solo HTTPS en prod
  sameSite: "strict",         // Protección CSRF
  maxAge: 30 * 24 * 60 * 60 * 1000, // 30 días en ms
};

// ─── HANDLER GENÉRICO DE ERRORES ─────────────────────────────────────────
const handleError = (res, error) => {
  const status = error.statusCode || 500;
  const message =
    status === 500 ? "Error interno del servidor" : error.message;

  if (status === 500) {
    console.error("❌ Error interno:", error);
  }

  return res.status(status).json({ success: false, message });
};

// Inicia OAuth — genera state, lo guarda en cookie firmada (stateless, sin sesión)
export const googleInitiate = (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");

  // Guardamos state en cookie firmada para validar en el callback (anti-CSRF)
  res.cookie("oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 10 * 60 * 1000, // 10 minutos
    signed: true,
    sameSite: "lax",
  });

  // Pasamos el state explícitamente para garantizar el anti-CSRF
  passport.authenticate("google", {
    scope: ["profile", "email"],
    session: false,
    state,
  })(req, res);
};

// Callback de Google — valida state y emite JWT de REVIXY vía cookies
export const googleCallback = (req, res, next) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

  // Step 2.1 — Detectamos cancelación o error de Google ANTES de procesar nada
  if (req.query.error) {
    return res.redirect(`${frontendUrl}/login?error=auth_cancelled`);
  }

  // Verificamos state contra la cookie firmada para prevenir CSRF
  const receivedState = req.query.state;
  const storedState = req.signedCookies?.oauth_state;

  if (!storedState || receivedState !== storedState) {
    return res.redirect(`${frontendUrl}/login?error=invalid_state`);
  }
  res.clearCookie("oauth_state");

  passport.authenticate("google", { session: false }, async (err, result) => {
    if (err || !result) {
      const errorCode =
        err?.statusCode === 403 ? "email_not_verified" : "google_auth_failed";
      return res.redirect(`${frontendUrl}/login?error=${errorCode}`);
    }

    const { accessToken, refreshToken } = result;

    // Refresh token en cookie httpOnly
    res.cookie("refreshToken", refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    // Seguridad: accessToken via cookie temporal (evitamos exposición en URL)
    res.cookie("oauth_handoff", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 5 * 60 * 1000, // 5 minutos
      signed: true,
      sameSite: "lax",
    });

    return res.redirect(`${frontendUrl}/auth/callback`);
  })(req, res, next);
};

// El frontend llama aquí para intercambiar la cookie de handoff por el accessToken
export const getOAuthToken = (req, res) => {
  const token = req.signedCookies?.oauth_handoff;
  if (!token) {
    return res
      .status(401)
      .json({ success: false, error: "No handoff token found" });
  }

  // Limpiamos la cookie inmediatamente tras leerla (ventana de uso mínima)
  res.clearCookie("oauth_handoff");
  return res.status(200).json({ success: true, data: { accessToken: token } });
};

// ─── POST /api/auth/register ──────────────────────────────────────────────
const register = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const { user, accessToken, refreshToken } = await authService.register({
      name,
      email,
      password,
    });

    res.cookie("refreshToken", refreshToken, cookieOptions);

    return res.status(201).json({
      success: true,
      message: "Usuario registrado correctamente",
      data: { user, accessToken },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── POST /api/auth/login ─────────────────────────────────────────────────
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const { user, accessToken, refreshToken } = await authService.login({
      email,
      password,
    });

    res.cookie("refreshToken", refreshToken, cookieOptions);

    return res.status(200).json({
      success: true,
      message: "Login exitoso",
      data: { user, accessToken },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── POST /api/auth/refresh ───────────────────────────────────────────────
const refresh = async (req, res) => {
  try {
    // Token puede venir de cookie o body
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    const { accessToken, refreshToken } = await authService.refreshTokens(token);

    res.cookie("refreshToken", refreshToken, cookieOptions);

    return res.status(200).json({
      success: true,
      data: { accessToken },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── POST /api/auth/logout ────────────────────────────────────────────────
const logout = async (req, res) => {
  try {
    await authService.logout(req.user.id);

    res.clearCookie("refreshToken", cookieOptions);

    return res.status(200).json({
      success: true,
      message: "Sesión cerrada correctamente",
    });
  } catch (error) {
    return handleError(res, error);
  }
};

// ─── GET /api/auth/me ─────────────────────────────────────────────────────
const getMe = async (req, res) => {
  try {
    const user = await authService.getProfile(req.user.id);

    return res.status(200).json({
      success: true,
      data: { user },
    });
  } catch (error) {
    return handleError(res, error);
  }
};

export { register, login, refresh, logout, getMe };