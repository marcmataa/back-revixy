import Store from "../models/Store.model.js";
import ActionLogs from "../models/ActionLogs.model.js";

const ALLOWED_ROOT_FIELDS = new Set(["timezone", "currency", "monthlyGoals", "language",]);
const ALLOWED_SETTINGS_FIELDS = new Set([
  "defaultMarginPercent",
  "defaultGatewayFeePercent",
  "defaultGatewayFeeFixed",
  "defaultShippingCost",
  "executionMode",
  "strategy",
  "industry", 
]);

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const sanitizeSettingsPayload = (settingsPayload = {}) => {
  const sanitizedUpdate = {};

  // Validamos ownership por JWT y aplicamos whitelist para bloquear campos no permitidos.
  for (const [key, value] of Object.entries(settingsPayload)) {
    if (ALLOWED_ROOT_FIELDS.has(key)) {
      sanitizedUpdate[key] = value;
      continue;
    }

    if (ALLOWED_SETTINGS_FIELDS.has(key)) {
      sanitizedUpdate[`settings.${key}`] = value;
    }
  }

  return { sanitizedUpdate };
};

const getStoreByOwner = async (userId) => {
  const store = await Store.findOne({ owner: userId }).select("-accessToken");
  if (!store) {
    throw createError("Store not found", 404);
  }
  return store;
};

const updateSettings = async (userId, settingsPayload) => {
  const store = await Store.findOne({ owner: userId }).select("_id");
  if (!store) {
    throw createError("Store not found", 404);
  }

  const { sanitizedUpdate } = sanitizeSettingsPayload(settingsPayload);
  if (Object.keys(sanitizedUpdate).length === 0) {
    throw createError("No valid fields provided for update", 400);
  }

  const updatedStore = await Store.findOneAndUpdate(
    { owner: userId },
    { $set: sanitizedUpdate },
    { new: true, runValidators: true }
  ).select("-accessToken");

  await ActionLogs.create({
    storeId: store._id,
    userId,
    type: "AUTH_EVENT",
    status: "SUCCESS",
    message: "Store settings updated",
    metadata: { updatedFields: Object.keys(settingsPayload || {}) },
  });

  return updatedStore;
};

const getBreakEvenROAS = async (userId) => {
  const store = await Store.findOne({ owner: userId }).select(
    "settings.defaultMarginPercent"
  );
  if (!store) {
    throw createError("Store not found", 404);
  }

  const marginPercent = store.settings?.defaultMarginPercent;
  if (marginPercent === 0) {
    throw createError("Cannot calculate break-even with 0% margin", 400);
  }

  const breakEvenROAS = 1 / (marginPercent / 100);
  return { breakEvenROAS, marginPercent };
};

export { getStoreByOwner, updateSettings, getBreakEvenROAS };
