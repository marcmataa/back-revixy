// src/controllers/auth.controller.js
import * as authService from "../services/auth.service.js";

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