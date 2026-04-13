import axios from "axios";
import crypto from "crypto";
import { randomUUID } from "crypto";
import Store from "../models/Store.model.js";
import ActionLogs from "../models/ActionLogs.model.js";

// ENV REQUIRED:
// SHOPIFY_API_KEY=
// SHOPIFY_API_SECRET=
// SHOPIFY_WEBHOOK_SECRET=
// SHOPIFY_REDIRECT_URI=http://localhost:3000/api/integrations/shopify/callback
// SHOPIFY_API_VERSION=2024-04

const SHOPIFY_SCOPES = ["read_orders", "read_products", "read_inventory", "read_analytics"];

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

const parseLinkHeader = (value) => {
  if (!value) return null;
  const next = String(value)
    .split(",")
    .map((part) => part.trim())
    .find((part) => part.includes('rel="next"'));
  if (!next) return null;
  const match = next.match(/<([^>]+)>/);
  if (!match?.[1]) return null;
  const url = new URL(match[1]);
  return url.searchParams.get("page_info");
};

const shouldThrottle = (headerValue) => {
  if (!headerValue) return false;
  const [used, total] = String(headerValue).split("/").map(Number);
  if (!used || !total) return false;
  return used / total > 0.8;
};

const withShopifyApiCall = async ({ store, endpoint, requestFn }) => {
  const startedAt = Date.now();
  try {
    const response = await requestFn();
    await logAction({
      storeId: store?._id,
      type: "API_CALL",
      status: "SUCCESS",
      message: `Shopify API call success: ${endpoint}`,
      duration: Date.now() - startedAt,
      metadata: { endpoint, shopifyDomain: maskValue(store?.shopifyDomain) },
    });
    return response;
  } catch (error) {
    await logAction({
      storeId: store?._id,
      type: "API_CALL",
      status: "FAIL",
      message: `Shopify API call failed: ${endpoint}`,
      duration: Date.now() - startedAt,
      metadata: { endpoint, error: error.message, shopifyDomain: maskValue(store?.shopifyDomain) },
    });
    throw error;
  }
};

const shopifyRequest = async ({ store, endpoint, params = {}, retries = 0 }) => {
  const token = store.getDecryptedAccessToken();
  const version = process.env.SHOPIFY_API_VERSION || "2024-04";
  const url = `https://${store.shopifyDomain}/admin/api/${version}${endpoint}`;

  try {
    const response = await withShopifyApiCall({
      store,
      endpoint,
      requestFn: () =>
        axios.get(url, {
          params,
          headers: {
            "X-Shopify-Access-Token": token,
            "Content-Type": "application/json",
          },
        }),
    });
    if (shouldThrottle(response.headers["x-shopify-shop-api-call-limit"])) {
      // Añadimos espera corta para respetar cuota cuando supera el 80%.
      await delay(500);
    }
    return response;
  } catch (error) {
    const status = error?.response?.status;
    if (status === 401) {
      await Store.findByIdAndUpdate(store._id, { status: "REAUTH_REQUIRED" });
      await logAction({
        storeId: store._id,
        type: "API_ERROR",
        status: "FAIL",
        message: "Shopify token unauthorized, reauth required",
        metadata: { endpoint },
      });
      throw new Error("Shopify token expired or invalid");
    }

    if (status === 429 && retries < 3) {
      const retryAfterHeader = Number(error?.response?.headers?.["retry-after"] || 1);
      // Respetamos Retry-After y reintentamos un máximo de 3 veces.
      await delay(retryAfterHeader * 1000);
      return shopifyRequest({ store, endpoint, params, retries: retries + 1 });
    }

    throw error;
  }
};

const initiateOAuth = async (shop, redirectUri, userId) => {
  if (!shop || !redirectUri || !userId) {
    throw new Error("shop, redirectUri and userId are required");
  }

  const state = randomUUID();
  const stateHash = hashValue(state);
  await logAction({
    userId,
    type: "AUTH_EVENT",
    status: "PENDING",
    message: "Shopify OAuth initiated",
    metadata: { provider: "shopify", stateHash, shop: maskValue(shop) },
  });

  const params = new URLSearchParams({
    client_id: process.env.SHOPIFY_API_KEY,
    scope: SHOPIFY_SCOPES.join(","),
    redirect_uri: redirectUri,
    state,
  });
  return `https://${shop}/admin/oauth/authorize?${params.toString()}`;
};

// El callback de Shopify no lleva JWT — buscamos el CSRF log por stateHash
// (SHA-256 de UUID, 256 bits de entropía: seguro sin filtro por userId).
// Retornamos { accessToken, userId } para que el controller pueda asignar el owner del store.
const exchangeCodeForToken = async (shop, code, state) => {
  if (!shop || !code || !state) {
    throw new Error("shop, code and state are required");
  }

  const stateHash = hashValue(state);
  // Buscamos el log de estado pendiente por hash — sin userId ya que viene del redirect de Shopify
  const csrfLog = await ActionLogs.findOne({
    type: "AUTH_EVENT",
    status: "PENDING",
    "metadata.provider": "shopify",
    "metadata.stateHash": stateHash,
  }).sort({ createdAt: -1 });
  if (!csrfLog) {
    throw new Error("Invalid OAuth state");
  }

  // Recuperamos el userId del log original — creado en initiateOAuth con req.user.id
  const userId = csrfLog.userId;

  try {
    const response = await axios.post(`https://${shop}/admin/oauth/access_token`, {
      client_id: process.env.SHOPIFY_API_KEY,
      client_secret: process.env.SHOPIFY_API_SECRET,
      code,
    });
    csrfLog.status = "SUCCESS";
    csrfLog.message = "Shopify OAuth state validated";
    await csrfLog.save();
    // Retornamos accessToken y userId para que el controller asocie el store al owner correcto
    return { accessToken: response.data?.access_token, userId };
  } catch (error) {
    await logAction({
      userId,
      type: "AUTH_EVENT",
      status: "FAIL",
      message: "Shopify token exchange failed",
      metadata: { provider: "shopify", shop: maskValue(shop), error: error.message },
    });
    throw new Error("Failed to exchange Shopify code for token");
  }
};

const validateWebhookHmac = (rawBody, hmacHeader) => {
  if (!rawBody || !hmacHeader || !process.env.SHOPIFY_WEBHOOK_SECRET) return false;
  const digest = crypto
    .createHmac("sha256", process.env.SHOPIFY_WEBHOOK_SECRET)
    .update(rawBody, "utf8")
    .digest("base64");
  const expected = Buffer.from(digest);
  const received = Buffer.from(hmacHeader);
  if (expected.length !== received.length) return false;
  return crypto.timingSafeEqual(expected, received);
};

const fetchOrders = async (store, params = {}) => {
  try {
    let nextPageInfo = null;
    const items = [];
    do {
      const query = { limit: params.limit || 50, status: params.status || "any", ...params };
      if (nextPageInfo) query.page_info = nextPageInfo;
      const response = await shopifyRequest({ store, endpoint: "/orders.json", params: query });
      items.push(...(response.data?.orders || []));
      nextPageInfo = parseLinkHeader(response.headers.link);
    } while (nextPageInfo);
    return { success: true, data: { orders: items } };
  } catch (error) {
    await logAction({
      storeId: store?._id,
      type: "API_ERROR",
      status: "FAIL",
      message: "Failed to fetch Shopify orders",
      metadata: { error: error.message },
    });
    return { success: false, error: { message: "Failed to fetch Shopify orders", details: error.message } };
  }
};

const fetchProducts = async (store, params = {}) => {
  try {
    let nextPageInfo = null;
    const products = [];
    do {
      const query = { limit: params.limit || 50, ...params };
      if (nextPageInfo) query.page_info = nextPageInfo;
      const productResponse = await shopifyRequest({ store, endpoint: "/products.json", params: query });
      const pageProducts = productResponse.data?.products || [];
      products.push(...pageProducts);
      nextPageInfo = parseLinkHeader(productResponse.headers.link);
    } while (nextPageInfo);

    const inventoryItemIds = products
      .flatMap((product) => product.variants || [])
      .map((variant) => variant.inventory_item_id)
      .filter(Boolean);
    const uniqueIds = [...new Set(inventoryItemIds)].slice(0, 250);
    let inventoryLevels = [];
    if (uniqueIds.length > 0) {
      const inventoryResponse = await shopifyRequest({
        store,
        endpoint: "/inventory_levels.json",
        params: { inventory_item_ids: uniqueIds.join(",") },
      });
      inventoryLevels = inventoryResponse.data?.inventory_levels || [];
    }

    return { success: true, data: { products, inventoryLevels } };
  } catch (error) {
    await logAction({
      storeId: store?._id,
      type: "API_ERROR",
      status: "FAIL",
      message: "Failed to fetch Shopify products",
      metadata: { error: error.message },
    });
    return { success: false, error: { message: "Failed to fetch Shopify products", details: error.message } };
  }
};

const disconnectShopify = async (storeId) => {
  // Limpiamos el token y marcamos el store como REAUTH_REQUIRED.
  // El ETL worker skipea este estado automáticamente — sin riesgo de API calls con token vacío.
  // No limpiamos shopifyDomain: el flujo de reconect lo necesita como clave de búsqueda
  // en handleShopifyCallback (findOneAndUpdate por shopifyDomain con upsert).
  // runValidators omitido — accessToken: "" no pasaría la validación required del schema.
  await Store.findByIdAndUpdate(
    storeId,
    { $set: { accessToken: "", status: "REAUTH_REQUIRED" } }
  );
};

export {
  initiateOAuth,
  exchangeCodeForToken,
  validateWebhookHmac,
  fetchOrders,
  fetchProducts,
  disconnectShopify,
};
