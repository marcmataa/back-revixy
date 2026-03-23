// src/services/auth.service.js
import jwt from "jsonwebtoken";
import User from "../models/User.model.js";

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
  // SEGURIDAD: Prevenimos error de bcrypt si el usuario no tiene contraseña local
  if (user.authProvider === "google") {
    const error = new Error(
      "Esta cuenta utiliza Google. Inicia sesión con Google o establece una contraseña primero."
    );
    error.statusCode = 400;
    throw error;
  }
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

// ─── SERVICIO: GOOGLE AUTH (OAUTH 2.0) ─────────────────────────────────────

// Upsert de usuario via Google con prevención de account takeover
const googleAuth = async (profile) => {
  const email = profile.emails?.[0]?.value;
  const googleId = profile.id;
  const name = profile.displayName || profile.name?.givenName || "User";
  const rawAvatar = profile.photos?.[0]?.value || null;
  // Solo guardamos avatars HTTPS — nunca HTTP
  const avatar = rawAvatar?.startsWith("https://") ? rawAvatar : null;

  if (!email) {
    const err = new Error("Google profile missing email");
    err.statusCode = 400;
    throw err;
  }

  // Caso 1: Ya tiene googleId → login directo
  // Usamos .select("+googleId") porque googleId tiene select: false en el modelo
  let user = await User.findOne({ googleId }).select("+googleId");
  if (user) {
    const tokens = signTokens(user);
    user.refreshToken = tokens.refreshToken;
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });
    return { user, ...tokens };
  }

  // Caso 2: Existe email sin googleId — buscamos por email (no necesita select especial)
  user = await User.findOne({ email });
  if (user) {
    // SEGURIDAD CRÍTICA: Solo vinculamos si el email está verificado
    // Evitamos account takeover si alguien registró el email sin verificarlo
    if (!user.isEmailVerified) {
      const err = new Error("Verifica tu email antes de vincular Google.");
      err.statusCode = 403;
      throw err;
    }

    // Vinculamos Google — actualizamos authProvider según state machine
    // local → both | google → google (ya tiene googleId, no debería llegar aquí)
    user.googleId = googleId;
    user.avatar = avatar || user.avatar;
    user.authProvider = user.authProvider === "local" ? "both" : user.authProvider;

    const tokens = signTokens(user);
    user.refreshToken = tokens.refreshToken;
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });
    return { user, ...tokens };
  }

  // Caso 3: Usuario nuevo via Google
  // Protección contra race condition — manejamos duplicate key (code 11000)
  try {
    user = await User.create({
      name,
      email,
      googleId,
      avatar,
      authProvider: "google",
      isEmailVerified: true, // Google garantiza ownership del email
      isActive: true,
    });
  } catch (error) {
    if (error.code === 11000) {
      // Condición de carrera — otro request creó el usuario simultáneamente
      // Recuperamos el usuario ganador y continuamos sin romper el flujo
      user = await User.findOne({ email });
      if (!user) throw new Error("Unexpected race condition in user creation");
    } else {
      throw error;
    }
  }

  const tokens = signTokens(user);
  user.refreshToken = tokens.refreshToken;
  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });
  return { user, ...tokens };
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

export { register, login, googleAuth, refreshTokens, logout, getProfile };