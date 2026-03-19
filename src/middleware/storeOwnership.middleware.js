import Store from "../models/Store.model.js";

// Verificamos que el storeId del request pertenece al usuario autenticado.
const storeOwnership = async (req, res, next) => {
  try {
    const storeId = req.params.storeId || req.query.storeId;
    if (!storeId) {
      return res.status(400).json({ success: false, error: "storeId is required" });
    }

    const store = await Store.findById(storeId).select("owner status shopifyDomain metaAdAccountId");
    if (!store) {
      return res.status(404).json({ success: false, error: "Store not found" });
    }

    if (store.owner.toString() !== req.user.id.toString()) {
      return res.status(403).json({ success: false, error: "Forbidden store access" });
    }

    req.store = store;
    next();
  } catch (error) {
    return res.status(500).json({ success: false, error: "Failed to validate store ownership" });
  }
};

export { storeOwnership };
