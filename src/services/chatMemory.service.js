import crypto from "crypto";
import ChatMemory from "../models/ChatMemory.model.js";
import ActionLogs from "../models/ActionLogs.model.js";
import { sanitizeAIOutput } from "./promptSanitizer.service.js";

async function getOrCreateSession(storeId, sessionId) {
  const existing =
    sessionId && (await ChatMemory.findOne({ sessionId, storeId }).select("+messages"));
  if (existing) return existing;

  return ChatMemory.create({
    storeId,
    sessionId: crypto.randomUUID(),
    messages: [],
    summary: "",
    totalTokensUsed: 0,
    lastActiveAt: new Date(),
  });
}

async function compressOldMessages(sessionId, summarizeMessages) {
  const session = await ChatMemory.findOne({ sessionId });
  if (!session || session.messages.length <= 10) return session;

  const oldMessages = session.messages.slice(0, -10);
  const compact = oldMessages
    .map((item) => `${item.role.toUpperCase()}: ${String(item.content || "")}`)
    .join("\n");

  let summary = "Previous messages discussed business metrics and operational actions.";
  if (typeof summarizeMessages === "function") {
    const summarized = await summarizeMessages(compact);
    summary = sanitizeAIOutput(summarized || summary);
  }

  session.summary = summary;
  session.messages = session.messages.slice(-10);
  session.lastActiveAt = new Date();
  await session.save();

  await ActionLogs.create({
    storeId: session.storeId,
    type: "AI_INSIGHT",
    status: "SUCCESS",
    message: "Chat memory compressed",
    metadata: { sessionId, compressedCount: oldMessages.length },
  });

  return session;
}

async function addMessage(sessionId, { role, content, tokensUsed = 0 }, summarizeMessages) {
  const session = await ChatMemory.findOne({ sessionId });
  if (!session) return null;

  session.messages.push({
    role,
    content,
    tokensUsed: Number(tokensUsed) || 0,
    timestamp: new Date(),
  });
  session.totalTokensUsed += Number(tokensUsed) || 0;
  session.lastActiveAt = new Date();
  await session.save();

  if (session.messages.length > 10) {
    return compressOldMessages(sessionId, summarizeMessages);
  }
  return session;
}

async function getRecentHistory(sessionId) {
  const session = await ChatMemory.findOne({ sessionId }).lean();
  if (!session) return [];

  const recent = (session.messages || []).slice(-10).map((item) => ({
    role: item.role,
    content: item.content,
  }));
  if (session.summary) {
    return [{ role: "system", content: `Previous conversation summary: ${session.summary}` }, ...recent];
  }
  return recent;
}

async function deleteSession(storeId, sessionId) {
  const session = await ChatMemory.findOne({ sessionId });
  if (!session) return { deleted: false };
  if (session.storeId.toString() !== storeId.toString()) {
    return { deleted: false, error: "FORBIDDEN" };
  }
  await ChatMemory.deleteOne({ _id: session._id });
  return { deleted: true };
}

export { getOrCreateSession, addMessage, compressOldMessages, getRecentHistory, deleteSession };
