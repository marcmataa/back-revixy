const MAX_USER_INPUT_LENGTH = 500;
const MAX_AI_OUTPUT_LENGTH = 2000;

const INJECTION_PATTERNS = [
  /ignore (previous|all) instructions/i,
  /you are now/i,
  /act as/i,
  /jailbreak/i,
  /system prompt/i,
  /forget (your|all)/i,
  /disregard/i,
];

const PII_FIELDS = new Set([
  "customerEmail",
  "customerName",
  "shippingAddress",
  "billingAddress",
  "phone",
  "ip",
]);

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function sanitizeUserInput(input) {
  const normalized = String(input || "").trim().slice(0, MAX_USER_INPUT_LENGTH);
  const hasInjection = INJECTION_PATTERNS.some((pattern) => pattern.test(normalized));
  if (hasInjection) {
    throw new Error("INJECTION_DETECTED");
  }
  return `<user_query>${normalized}</user_query>`;
}

function maskObjectIdValue(value) {
  if (typeof value !== "string") return value;
  const objectIdPattern = /^[a-fA-F0-9]{24}$/;
  if (!objectIdPattern.test(value)) return value;
  return `${value.slice(0, 8)}...`;
}

function shouldStripByName(key) {
  return /token|secret|key|password/i.test(String(key));
}

function sanitizeBusinessContext(data) {
  if (Array.isArray(data)) {
    return data.map((item) => sanitizeBusinessContext(item));
  }

  if (isPlainObject(data)) {
    const sanitized = {};
    for (const [key, value] of Object.entries(data)) {
      if (PII_FIELDS.has(key)) continue;
      if (shouldStripByName(key)) continue;
      sanitized[key] = sanitizeBusinessContext(value);
    }
    return sanitized;
  }

  if (typeof data === "string") {
    return maskObjectIdValue(data);
  }

  return data;
}

function sanitizeAIOutput(output) {
  return String(output || "")
    .replace(/\S+@\S+\.\S+/g, "[REDACTED]")
    .replace(/sk-[a-zA-Z0-9]{20,}/g, "[REDACTED]")
    .trim()
    .slice(0, MAX_AI_OUTPUT_LENGTH);
}

export {
  sanitizeUserInput,
  sanitizeBusinessContext,
  sanitizeAIOutput,
  INJECTION_PATTERNS,
};
