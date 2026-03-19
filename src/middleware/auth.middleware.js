// src/middleware/auth.middleware.js
import jwt from "jsonwebtoken";
import User from "../models/User.model.js";

/**
 * Middleware: Verifica el JWT del header Authorization
 * Uso: router.get('/ruta-protegida', authMiddleware, controller)
 */
const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Acceso denegado. Token no proporcionado",
      });
    }

    const token = authHeader.split(" ")[1];

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      const message =
        err.name === "TokenExpiredError"
          ? "Token expirado"
          : "Token inválido";
      return res.status(401).json({ success: false, message });
    }

    // Verificar que el usuario todavía existe
    const user = await User.findById(decoded.id);
    if (!user) {
      return res
        .status(401)
        .json({ success: false, message: "Usuario no encontrado" });
    }

    // Verificar que la cuenta esté activa
    if (!user.isActive) {
      return res
        .status(403)
        .json({ success: false, message: "Cuenta desactivada" });
    }

    // Verificar que la contraseña no cambió después de emitir el token
    if (user.passwordChangedAt) {
      const changedAt = parseInt(user.passwordChangedAt.getTime() / 1000, 10);
      if (decoded.iat < changedAt) {
        return res.status(401).json({
          success: false,
          message: "Contraseña cambiada recientemente. Inicia sesión de nuevo",
        });
      }
    }

    req.user = { id: user._id, role: user.role };
    next();
  } catch (error) {
    console.error("Error en authMiddleware:", error);
    return res
      .status(500)
      .json({ success: false, message: "Error interno del servidor" });
  }
};

/**
 * Middleware: Restricción por rol
 * Uso: router.delete('/admin/ruta', protect, restrictTo('admin'), controller)
 */
const restrictTo = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: "No tienes permisos para realizar esta acción",
      });
    }
    next();
  };
};

export { protect, restrictTo };