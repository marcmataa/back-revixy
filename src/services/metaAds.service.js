import axios from "axios";
import crypto from "crypto";
import { randomUUID } from "crypto";
import Store from "../models/Store.model.js";
import ActionLogs from "../models/ActionLogs.model.js";

// ENV REQUIRED:
// META_APP_ID=
// META_APP_SECRET=
// META_REDIRECT_URI=http://localhost:3000/api/integrations/meta/callback

const META_SCOPES = ["ads_read", "ads_management", "business_management"];
const META_BASE_URL = "https://graph.facebook.com/v19.0";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const hashValue = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex");

const maskValue = (value) => {
  if (!value || typeof value !== "string") return undefined;
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
};

const logAction = async ({
  storeId,
  userId,
  type,
  status,
  message,
  duration = 0,
  metadata,
}) => {
  try {
    await ActionLogs.create({ storeId, userId, type, status, message, duration, metadata });
  } catch {
    // Evitamos romper el flujo si falla el logging.
  }
};

const withMetaApiCall = async ({ store, endpoint, requestFn }) => {
  const startedAt = Date.now();
  try {
    const response = await requestFn();
    await logAction({
      storeId: store?._id,
      type: "API_CALL",
      status: "SUCCESS",
      message: `Meta API call success: ${endpoint}`,
      duration: Date.now() - startedAt,
      metadata: { endpoint, adAccountId: maskValue(store?.metaAdAccountId) },
    });
    return response;
  } catch (error) {
    await logAction({
      storeId: store?._id,
      type: "API_CALL",
      status: "FAIL",
      message: `Meta API call failed: ${endpoint}`,
      duration: Date.now() - startedAt,
      metadata: { endpoint, error: error.message, adAccountId: maskValue(store?.metaAdAccountId) },
    });
    throw error;
  }
};

const validateOAuthState = async (state, userId) => {
  const stateHash = hashValue(state);
  const csrfLog = await ActionLogs.findOne({
    userId,
    type: "AUTH_EVENT",
    status: "PENDING",
    "metadata.provider": "meta",
    "metadata.stateHash": stateHash,
  }).sort({ createdAt: -1 });
  if (!csrfLog) throw new Error("Invalid OAuth state");
  csrfLog.status = "SUCCESS";
  csrfLog.message = "Meta OAuth state validated";
  await csrfLog.save();
};

const initiateOAuth = async (redirectUri, userId, storeId) => {
  if (!redirectUri || !userId || !storeId) {
    throw new Error("redirectUri, userId and storeId are required");
  }

  const state = randomUUID();
  const stateHash = hashValue(state);
  await logAction({
    storeId,
    userId,
    type: "AUTH_EVENT",
    status: "PENDING",
    message: "Meta OAuth initiated",
    metadata: { provider: "meta", stateHash },
  });

  const params = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: redirectUri,
    state,
    scope: META_SCOPES.join(","),
  });
  return `${META_BASE_URL.replace("graph.", "www.")}/dialog/oauth?${params.toString()}`;
};

const exchangeCodeForToken = async (code, redirectUri, state, userId, storeId) => {
  if (!code || !redirectUri || !state || !userId) {
    throw new Error("code, redirectUri, state and userId are required");
  }

  await validateOAuthState(state, userId);

  try {
    const shortLived = await axios.get(`${META_BASE_URL}/oauth/access_token`, {
      params: {
        client_id: process.env.META_APP_ID,
        client_secret: process.env.META_APP_SECRET,
        redirect_uri: redirectUri,
        code,
      },
    });

    const longLived = await axios.get(`${META_BASE_URL}/oauth/access_token`, {
      params: {
        grant_type: "fb_exchange_token",
        client_id: process.env.META_APP_ID,
        client_secret: process.env.META_APP_SECRET,
        fb_exchange_token: shortLived.data.access_token,
      },
    });

    const expiresAt = new Date(Date.now() + (longLived.data.expires_in || 0) * 1000);
    await logAction({
      storeId,
      userId,
      type: "AUTH_EVENT",
      status: "SUCCESS",
      message: "Meta token exchange success",
      metadata: { provider: "meta", expiresAt: expiresAt.toISOString() },
    });

    return { accessToken: longLived.data.access_token, expiresAt };
  } catch (error) {
    await logAction({
      storeId,
      userId,
      type: "AUTH_EVENT",
      status: "FAIL",
      message: "Meta token exchange failed",
      metadata: { provider: "meta", error: error.message },
    });
    throw new Error("Failed to exchange Meta code for token");
  }
};

const refreshToken = async (store) => {
  try {
    const currentToken = store.getDecryptedAccessToken();
    const response = await withMetaApiCall({
      store,
      endpoint: "/oauth/access_token",
      requestFn: () =>
        axios.get(`${META_BASE_URL}/oauth/access_token`, {
          params: {
            grant_type: "fb_exchange_token",
            client_id: process.env.META_APP_ID,
            client_secret: process.env.META_APP_SECRET,
            fb_exchange_token: currentToken,
          },
        }),
    });
    const expiresAt = new Date(Date.now() + (response.data.expires_in || 0) * 1000);
    return { success: true, token: response.data.access_token, expiresAt };
  } catch (error) {
    await Store.findByIdAndUpdate(store._id, { status: "REAUTH_REQUIRED" });
    await logAction({
      storeId: store._id,
      type: "API_ERROR",
      status: "FAIL",
      message: "Meta refresh failed, reauth required",
      metadata: { error: error.message },
    });
    return { success: false, error: "Failed to refresh Meta token" };
  }
};

const metaRequest = async ({ store, endpoint, params = {}, attempt = 0 }) => {
  try {
    const token = store.getDecryptedAccessToken();
    return await withMetaApiCall({
      store,
      endpoint,
      requestFn: () =>
        axios.get(`${META_BASE_URL}${endpoint}`, {
          params: { ...params, access_token: token },
        }),
    });
  } catch (error) {
    const code = error?.response?.data?.error?.code;
    if (code === 190) {
      const refreshed = await refreshToken(store);
      if (!refreshed.success) throw new Error("Meta token expired and refresh failed");
      await Store.findByIdAndUpdate(store._id, { accessToken: refreshed.token, status: "ACTIVE" });
      const updatedStore = await Store.findById(store._id).select("+accessToken");
      return metaRequest({ store: updatedStore, endpoint, params, attempt });
    }

    if (code === 17 && attempt < 5) {
      // Aplicamos backoff exponencial para protegernos de límites de Meta.
      const waitMs = 1000 * 2 ** attempt;
      await delay(waitMs);
      return metaRequest({ store, endpoint, params, attempt: attempt + 1 });
    }

    throw error;
  }
};

const fetchCampaignInsights = async (store, dateRange = {}) => {
  try {
    if (!store.metaAdAccountId) throw new Error("metaAdAccountId is missing");
    const accountId = store.metaAdAccountId.startsWith("act_")
      ? store.metaAdAccountId
      : `act_${store.metaAdAccountId}`;

    const fields = [
      "campaign_id",
      "campaign_name",
      "spend",
      "impressions",
      "clicks",
      "ctr",
      "cpc",
      "date_start",
      "date_stop",
    ].join(",");

    let after = null;
    const rows = [];
    do {
      const response = await metaRequest({
        store,
        endpoint: `/${accountId}/insights`,
        params: {
          fields,
          after,
          time_range: JSON.stringify(dateRange),
          level: "campaign",
          limit: 100,
          currency: store.currency,
        },
      });
      rows.push(...(response.data?.data || []));
      after = response.data?.paging?.cursors?.after || null;
    } while (after);

    return { success: true, data: { insights: rows } };
  } catch (error) {
    await logAction({
      storeId: store?._id,
      type: "API_ERROR",
      status: "FAIL",
      message: "Failed to fetch Meta campaign insights",
      metadata: { error: error.message },
    });
    return { success: false, error: { message: "Failed to fetch Meta campaign insights", details: error.message } };
  }
};

const fetchAdAccountInfo = async (store) => {
  try {
    const response = await metaRequest({
      store,
      endpoint: `/${store.metaAdAccountId}`,
      params: { fields: "id,name,account_status,spend_cap,currency" },
    });
    return { success: true, data: { adAccount: response.data } };
  } catch (error) {
    await logAction({
      storeId: store?._id,
      type: "API_ERROR",
      status: "FAIL",
      message: "Failed to fetch Meta ad account info",
      metadata: { error: error.message },
    });
    return { success: false, error: { message: "Failed to fetch Meta ad account info", details: error.message } };
  }
};

const fetchFirstAdAccount = async (accessToken) => {
  const response = await axios.get(`${META_BASE_URL}/me/adaccounts`, {
    params: { fields: "id,name,account_status,currency,spend_cap", limit: 1, access_token: accessToken },
  });
  return response.data?.data?.[0] || null;
};

export {
  initiateOAuth,
  exchangeCodeForToken,
  refreshToken,
  fetchCampaignInsights,
  fetchAdAccountInfo,
  fetchFirstAdAccount,
};
