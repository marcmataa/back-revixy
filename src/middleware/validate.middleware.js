// src/middleware/validate.middleware.js
const { body, validationResult } = require("express-validator");

/**
 * Ejecuta los resultados de validación y responde con errores si los hay
 */
const handleValidation = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      message: "Datos de entrada inválidos",
      errors: errors.array().map((e) => ({
        field: e.path,
        message: e.msg,
      })),
    });
  }
  next();
};

/**
 * Reglas de validación para registro
 */
const validateRegister = [
  body("name")
    .trim()
    .notEmpty().withMessage("El nombre es obligatorio")
    .isLength({ min: 2, max: 50 }).withMessage("El nombre debe tener entre 2 y 50 caracteres")
    .matches(/^[a-zA-ZÀ-ÿ\s]+$/).withMessage("El nombre solo puede contener letras"),

  body("email")
    .trim()
    .notEmpty().withMessage("El email es obligatorio")
    .isEmail().withMessage("Formato de email inválido")
    .normalizeEmail(),

  body("password")
    .notEmpty().withMessage("La contraseña es obligatoria")
    .isLength({ min: 8 }).withMessage("La contraseña debe tener al menos 8 caracteres")
    .matches(/[A-Z]/).withMessage("La contraseña debe contener al menos una mayúscula")
    .matches(/[0-9]/).withMessage("La contraseña debe contener al menos un número")
    .matches(/[^A-Za-z0-9]/).withMessage("La contraseña debe contener al menos un carácter especial"),

  handleValidation,
];

/**
 * Reglas de validación para login
 */
const validateLogin = [
  body("email")
    .trim()
    .notEmpty().withMessage("El email es obligatorio")
    .isEmail().withMessage("Formato de email inválido")
    .normalizeEmail(),

  body("password")
    .notEmpty().withMessage("La contraseña es obligatoria"),

  handleValidation,
];

module.exports = { validateRegister, validateLogin };