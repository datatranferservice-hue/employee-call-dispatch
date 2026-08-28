import OpenAI from "openai";

function headerObject(headers) {
  const result = new Headers();
  for (const [key, value] of Object.entries(headers || {})) {
    if (Array.isArray(value)) value.forEach(v => result.append(key, String(v)));
    else if (value !== undefined) result.set(key, String(value));
  }
  return result;
}

export function webhookVerificationMode() {
  if (process.env.OPENAI_WEBHOOK_SECRET) return "openai_signature";
  if (process.env.OPENAI_WEBHOOK_TOKEN) return "token_fallback";
  return "unconfigured";
}

export async function verifiedOpenAIEvent(req) {
  if (process.env.OPENAI_WEBHOOK_SECRET) {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY || "not-used-for-webhook-verification",
      webhookSecret: process.env.OPENAI_WEBHOOK_SECRET
    });
    return client.webhooks.unwrap(req.rawBody || "", headerObject(req.headers));
  }

  if (process.env.OPENAI_WEBHOOK_TOKEN && req.query?.token === process.env.OPENAI_WEBHOOK_TOKEN) {
    return req.body;
  }

  throw new Error("OpenAI webhook verification failed or is not configured");
}
