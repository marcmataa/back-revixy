import * as storeService from "../services/store.service.js";

const getStore = async (req, res) => {
  try {
    const store = await storeService.getStoreByOwner(req.user.id);
    return res.status(200).json({ success: true, data: { store } });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ success: false, error: error.message });
  }
};

const updateSettings = async (req, res) => {
  try {
    const store = await storeService.updateSettings(req.user.id, req.body);
    return res.status(200).json({ success: true, data: { store } });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ success: false, error: error.message });
  }
};

const getBreakEven = async (req, res) => {
  try {
    const { breakEvenROAS, marginPercent } = await storeService.getBreakEvenROAS(
      req.user.id
    );
    return res.status(200).json({
      success: true,
      data: { breakEvenROAS, marginPercent },
    });
  } catch (error) {
    return res
      .status(error.statusCode || 500)
      .json({ success: false, error: error.message });
  }
};

export { getStore, updateSettings, getBreakEven };
