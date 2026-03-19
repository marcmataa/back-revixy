import {
  generateInsight,
  chat as chatWithAI,
  simulateAction,
} from "../services/aiInsight.service.js";
import { deleteSession as deleteChatSession } from "../services/chatMemory.service.js";

const ALLOWED_ACTIONS = new Set(["PAUSE_CAMPAIGN", "SCALE_BUDGET", "RESTOCK"]);

const getInsight = async (req, res) => {
  try {
    const insight = await generateInsight(req.store._id);
    return res.status(200).json({ success: true, data: insight });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const chat = async (req, res) => {
  try {
    if (!req.body?.message) return res.status(400).json({ success: false, error: "message is required" });
    const data = await chatWithAI(req.store._id, req.body.sessionId, req.body.message);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const simulate = async (req, res) => {
  try {
    const action = req.body?.action;
    if (!action?.type || !ALLOWED_ACTIONS.has(action.type)) return res.status(400).json({ success: false, error: "invalid action type" });
    const result = await simulateAction(req.store._id, action);
    return res.status(200).json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

const deleteSession = async (req, res) => {
  try {
    const result = await deleteChatSession(req.store._id, req.params.sessionId);
    if (result.error === "FORBIDDEN") return res.status(403).json({ success: false, error: "Forbidden session access" });
    return res.status(200).json({ success: true, message: "Session deleted" });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

export { getInsight, chat, simulate, deleteSession };
