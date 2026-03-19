import express from "express";
import { body, validationResult } from "express-validator";
import { protect } from "../middleware/auth.middleware.js";
import {
  getStore,
  updateSettings,
  getBreakEven,
} from "../controllers/store.controller.js";

const router = express.Router();

const validateSettings = [
  body("defaultMarginPercent")
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage("defaultMarginPercent must be a number between 0 and 100"),
  body("defaultGatewayFeePercent")
    .optional()
    .isFloat({ min: 0, max: 100 })
    .withMessage("defaultGatewayFeePercent must be a number between 0 and 100"),
  body("defaultGatewayFeeFixed")
    .optional()
    .isInt({ min: 0 })
    .withMessage("defaultGatewayFeeFixed must be an integer >= 0"),
  body("defaultShippingCost")
    .optional()
    .isInt({ min: 0 })
    .withMessage("defaultShippingCost must be an integer >= 0"),
  body("executionMode")
    .optional()
    .isIn(["READ_ONLY", "COPILOT", "AUTOPILOT"])
    .withMessage("executionMode must be READ_ONLY, COPILOT or AUTOPILOT"),
  body("timezone")
    .optional()
    .isString()
    .trim()
    .notEmpty()
    .withMessage("timezone must be a non-empty string"),
  body("currency")
    .optional()
    .isString()
    .isLength({ min: 3, max: 3 })
    .withMessage("currency must be a 3-letter ISO 4217 code"),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({
        success: false,
        error: "Invalid settings payload",
      });
    }
    return next();
  },
];

router.get("/", protect, getStore);
router.patch("/settings", protect, validateSettings, updateSettings);
router.get("/breakeven", protect, getBreakEven);

export default router;
