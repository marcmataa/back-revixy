// src/services/auth.service.js
const jwt = require("jsonwebtoken");
const User = require("../models/User.model");

// ─── HELPERS JWT ──────────────────────────────────────────────────────────

const generateAccessToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    issuer: "auth-api",
  });
};

const generateRefreshToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
    issuer: "auth-api",
  });
};

const signTokens = (user) => {
  const payload = { id: user._id, role: user.role };
  return {
    accessToken: generateAccessToken(payload),
    refreshToken: generateRefreshToken(payload),
  };
};

// ─── SERVICIO: REGISTRO ───────────────────────────────────────────────────

const register = async ({ name, email, password }) => {
  // Verificar si el email ya existe
  const existing = await User.findOne({ email });
  if (existing) {
    const error = new Error("El email ya está registrado");
    error.statusCode = 409;
    throw error;
  }

  // Crear usuario (la contraseña se hashea en el pre-save del modelo)
  const user = await User.create({ name, email, password });

  const { accessToken, refreshToken } = signTokens(user);

  // Guardar refresh token hasheado en BD
  user.refreshToken = refreshToken;
  await user.save({ validateBeforeSave: false });

  return { user, accessToken, refreshToken };
};

// ─── SERVICIO: LOGIN ──────────────────────────────────────────────────────

const login = async ({ email, password }) => {
  // Buscar usuario incluyendo password (select: false en schema)
  const user = await User.findOne({ email }).select(
    "+password +refreshToken +loginAttempts +lockUntil"
  );

  if (!user) {
    // Mensaje genérico para no revelar si el email existe
    const error = new Error("Credenciales inválidas");
    error.statusCode = 401;
    throw error;
  }

  // Verificar si la cuenta está activa
  if (!user.isActive) {
    const error = new Error("Cuenta desactivada. Contacta al administrador");
    error.statusCode = 403;
    throw error;
  }

  // Verificar si la cuenta está bloqueada
  if (user.isLocked) {
    const minutesLeft = Math.ceil((user.lockUntil - Date.now()) / 60000);
    const error = new Error(
      `Cuenta bloqueada temporalmente. Intenta en ${minutesLeft} minuto(s)`
    );
    error.statusCode = 423;
    throw error;
  }

  // Verificar contraseña
  const isMatch = await user.comparePassword(password);

  if (!isMatch) {
    await user.incLoginAttempts();
    const error = new Error("Credenciales inválidas");
    error.statusCode = 401;
    throw error;
  }

  // Login exitoso → resetear intentos y registrar último login
  await User.findByIdAndUpdate(user._id, {
    $set: { loginAttempts: 0, lastLogin: new Date() },
    $unset: { lockUntil: 1 },
  });

  const { accessToken, refreshToken } = signTokens(user);

  // Actualizar refresh token en BD
  user.refreshToken = refreshToken;
  await user.save({ validateBeforeSave: false });

  return { user, accessToken, refreshToken };
};

// ─── SERVICIO: REFRESH TOKEN ──────────────────────────────────────────────

const refreshTokens = async (token) => {
  if (!token) {
    const error = new Error("Refresh token requerido");
    error.statusCode = 401;
    throw error;
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
  } catch {
    const error = new Error("Refresh token inválido o expirado");
    error.statusCode = 401;
    throw error;
  }

  const user = await User.findById(decoded.id).select("+refreshToken");

  if (!user || user.refreshToken !== token) {
    const error = new Error("Refresh token no válido");
    error.statusCode = 401;
    throw error;
  }

  const { accessToken, refreshToken: newRefreshToken } = signTokens(user);

  user.refreshToken = newRefreshToken;
  await user.save({ validateBeforeSave: false });

  return { accessToken, refreshToken: newRefreshToken };
};

// ─── SERVICIO: LOGOUT ─────────────────────────────────────────────────────

const logout = async (userId) => {
  await User.findByIdAndUpdate(userId, { $unset: { refreshToken: 1 } });
};

// ─── SERVICIO: PERFIL ─────────────────────────────────────────────────────

const getProfile = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    const error = new Error("Usuario no encontrado");
    error.statusCode = 404;
    throw error;
  }
  return user;
};

module.exports = { register, login, refreshTokens, logout, getProfile };