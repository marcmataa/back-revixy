import Store from "../models/Store.model.js";
import ActionLogs from "../models/ActionLogs.model.js";
import * as shopifyService from "../services/shopify.service.js";
import * as metaAdsService from "../services/metaAds.service.js";

const logAuthFail = async ({ userId, storeId, provider, error }) => {
  try {
    await ActionLogs.create({
      userId,
      storeId,
      type: "AUTH_EVENT",
      status: "FAIL",
      message: `${provider} auth flow failed`,
      metadata: { provider, error: error.message },
    });
  } catch {
    // Evitamos romper la respuesta por error de logging.
  }
};

const initiateShopifyOAuth = async (req, res) => {
  try {
    const { shop } = req.query;
    const redirectUri = process.env.SHOPIFY_REDIRECT_URI;
    const oauthUrl = await shopifyService.initiateOAuth(shop, redirectUri, req.user.id);
    return res.status(200).json({ success: true, data: { oauthUrl } });
  } catch (error) {
    await logAuthFail({ userId: req.user?.id, provider: "shopify", error });
    return res.status(400).json({ success: false, error: error.message });
  }
};

const handleShopifyCallback = async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  try {
    const { shop, code, state } = req.query;
    // Sin protect — userId se recupera del log CSRF creado en initiateOAuth
    const { accessToken, userId } = await shopifyService.exchangeCodeForToken(shop, code, state);
    const defaults = { defaultMarginPercent: 30, defaultShippingCost: 0 };
    const store = await Store.findOneAndUpdate(
      { shopifyDomain: String(shop).toLowerCase() },
      { owner: userId, shopifyDomain: String(shop).toLowerCase(), accessToken, timezone: "UTC", settings: defaults, status: "ACTIVE" },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    await ActionLogs.create({ storeId: store._id, userId, type: "AUTH_EVENT", status: "SUCCESS", message: "Shopify connected successfully", metadata: { provider: "shopify", shopifyDomain: `${String(shop).slice(0, 3)}***` } });
    // Redirigimos al frontend — nunca retornamos JSON en un callback OAuth
    return res.redirect(`${frontendUrl}/auth/shopify/callback?storeId=${store._id}&status=success`);
  } catch (error) {
    await logAuthFail({ provider: "shopify", error });
    return res.redirect(
      `${frontendUrl}/auth/shopify/callback?status=error&message=${encodeURIComponent(error.message)}`
    );
  }
};

const initiateMetaOAuth = async (req, res) => {
  try {
    const { storeId } = req.query;
    const redirectUri = process.env.META_REDIRECT_URI;
    const oauthUrl = await metaAdsService.initiateOAuth(redirectUri, req.user.id, storeId);
    return res.status(200).json({ success: true, data: { oauthUrl } });
  } catch (error) {
    await logAuthFail({ userId: req.user?.id, storeId: req.query?.storeId, provider: "meta", error });
    return res.status(400).json({ success: false, error: error.message });
  }
};

const handleMetaCallback = async (req, res) => {
  try {
    const { code, state, storeId } = req.query;
    const redirectUri = process.env.META_REDIRECT_URI;
    const { accessToken } = await metaAdsService.exchangeCodeForToken(code, redirectUri, state, req.user.id, storeId);
    const adAccount = await metaAdsService.fetchFirstAdAccount(accessToken);
    const store = await Store.findOneAndUpdate(
      { _id: storeId, owner: req.user.id },
      { accessToken, metaAdAccountId: adAccount?.id, status: "ACTIVE" },
      { new: true, runValidators: true }
    );
    if (!store) throw new Error("Store not found");
    await ActionLogs.create({ storeId: store._id, userId: req.user.id, type: "AUTH_EVENT", status: "SUCCESS", message: "Meta connected successfully", metadata: { provider: "meta", adAccountId: adAccount?.id ? `${adAccount.id.slice(0, 3)}***` : undefined } });
    return res.status(200).json({ success: true, data: { storeId: store._id, status: store.status } });
  } catch (error) {
    await logAuthFail({ userId: req.user?.id, storeId: req.query?.storeId, provider: "meta", error });
    return res.status(400).json({ success: false, error: error.message });
  }
};

const disconnectShopify = async (req, res) => {
  try {
    // Sin storeOwnership middleware — lookup por owner garantiza propiedad sin storeId en el request
    const store = await Store.findOne({ owner: req.user.id });
    if (!store) {
      return res.status(404).json({ success: false, error: "Store not found" });
    }

    await shopifyService.disconnectShopify(store._id);

    await ActionLogs.create({
      storeId: store._id,
      userId: req.user.id,
      type: "AUTH_EVENT",
      status: "SUCCESS",
      message: "Shopify disconnected",
      metadata: { provider: "shopify", shopifyDomain: `${String(store.shopifyDomain).slice(0, 3)}***` },
    });

    return res.status(200).json({ success: true, data: { storeId: store._id, shopifyConnected: false } });
  } catch (error) {
    return res.status(500).json({ success: false, error: "Failed to disconnect Shopify" });
  }
};

const getIntegrationStatus = async (req, res) => {
  try {
    const store = req.store;
    const data = { storeId: store._id, shopify: { connected: Boolean(store.shopifyDomain), status: store.status }, meta: { connected: Boolean(store.metaAdAccountId), status: store.status, adAccountId: store.metaAdAccountId || null } };
    return res.status(200).json({ success: true, data });
  } catch (error) {
    await logAuthFail({ userId: req.user?.id, storeId: req.query?.storeId, provider: "integration_status", error });
    return res.status(500).json({ success: false, error: "Failed to get integration status" });
  }
};

export {
  initiateShopifyOAuth,
  handleShopifyCallback,
  initiateMetaOAuth,
  handleMetaCallback,
  getIntegrationStatus,
  disconnectShopify,
};
