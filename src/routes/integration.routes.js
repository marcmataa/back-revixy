import express from "express";
import { protect } from "../middleware/auth.middleware.js";
import { storeOwnership } from "../middleware/storeOwnership.middleware.js";
import {
  initiateShopifyOAuth,
  handleShopifyCallback,
  initiateMetaOAuth,
  handleMetaCallback,
  getIntegrationStatus,
  disconnectShopify,
} from "../controllers/integration.controller.js";

const router = express.Router();

router.get("/shopify/connect", protect, initiateShopifyOAuth);
router.get("/shopify/callback", handleShopifyCallback);
router.get("/meta/connect", protect, storeOwnership, initiateMetaOAuth);
router.get("/meta/callback", protect, handleMetaCallback);
router.get("/status", protect, storeOwnership, getIntegrationStatus);
router.delete("/shopify", protect, disconnectShopify);

export default router;
