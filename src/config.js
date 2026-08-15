const requiredInProduction = [
  "DATABASE_URL",
  "APP_BASE_URL"
];

function asBool(value, fallback = false) {
  if (value == null || value === "") return fallback;

  return ["1", "true", "yes", "on"].includes(
    String(value).toLowerCase()
  );
}

function asInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stripTrailingSlash(value = "") {
  return String(value).replace(/\/+$/, "");
}

function csv(value = "") {
  return String(value)
    .split(",")
    .map(v => v.trim())
    .filter(Boolean);
}

const nodeEnv = process.env.NODE_ENV || "development";
const production = nodeEnv === "production";

if (production) {
  const missing = requiredInProduction.filter(
    key => !process.env[key]
  );

  if (missing.length) {
    throw new Error(
      `Missing required production environment variables: ${missing.join(", ")}`
    );
  }
}

export const config = Object.freeze({
  nodeEnv,
  production,

  port: asInt(process.env.PORT, 3000),

  appBaseUrl: stripTrailingSlash(
    process.env.APP_BASE_URL || "http://localhost:3000"
  ),

  trustProxy: asInt(
    process.env.TRUST_PROXY,
    production ? 1 : 0
  ),

  database: {
    url: process.env.DATABASE_URL || "",
    ssl: asBool(
      process.env.DATABASE_SSL,
      production
    )
  },

  security: {
    sessionHours: asInt(
      process.env.SESSION_HOURS,
      12
    ),

    allowedOrigins: csv(
      process.env.ALLOWED_ORIGINS ||
      process.env.APP_BASE_URL ||
      "http://localhost:3000"
    ),

    loginWindowMinutes: asInt(
      process.env.LOGIN_WINDOW_MINUTES,
      15
    ),

    loginMaxAttempts: asInt(
      process.env.LOGIN_MAX_ATTEMPTS,
      8
    )
  },

  defaults: {
    companyName:
      process.env.DEFAULT_COMPANY_NAME ||
      "Your Company",

    timezone:
      process.env.DEFAULT_TIMEZONE ||
      "America/Phoenix"
  },

  ai: {
    enabled: asBool(
      process.env.AI_ENABLED,
      true
    ),

    apiKey:
      process.env.OPENAI_API_KEY || "",

    model:
      process.env.OPENAI_MODEL ||
      "gpt-5.6"
  },

  telephony: {
    provider:
      process.env.TELEPHONY_PROVIDER ||
      "twilio",

    signatureRequired: asBool(
      process.env.WEBHOOK_SIGNATURE_REQUIRED,
      production
    ),

    twilio: {
      accountSid:
        process.env.TWILIO_ACCOUNT_SID || "",

      authToken:
        process.env.TWILIO_AUTH_TOKEN || "",

      phoneNumber:
        process.env.TWILIO_PHONE_NUMBER || ""
    }
  },

  maxJsonBody:
    process.env.MAX_JSON_BODY ||
    "1mb"
});
