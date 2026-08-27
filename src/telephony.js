const provider = () => String(process.env.TELEPHONY_PROVIDER || "twilio").trim().toLowerCase();

export function telephonyStatus() {
  const selected = provider();
  const twilioConfigured = Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_PHONE_NUMBER
  );
  return {
    provider: selected,
    configured: selected === "twilio" ? twilioConfigured : false,
    outboundTestSupported: selected === "twilio"
  };
}

export async function placeTestCall(to) {
  const status = telephonyStatus();
  if (status.provider !== "twilio") {
    throw new Error(`Outbound test calls are not implemented for provider ${status.provider}`);
  }
  if (!status.configured) {
    const error = new Error("Twilio credentials and calling number are not configured");
    error.code = "TELEPHONY_NOT_CONFIGURED";
    throw error;
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;
  const twiml = '<Response><Say voice="alice">CallFlow Command test call successful. Your calling system reached the approved owner phone.</Say></Response>';
  const body = new URLSearchParams({ To: to, From: from, Twiml: twiml });
  const authorization = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.message || `Telephony provider returned HTTP ${response.status}`);
    error.code = "TELEPHONY_PROVIDER_ERROR";
    error.providerStatus = response.status;
    throw error;
  }
  return {
    provider: "twilio",
    providerCallId: payload.sid,
    status: payload.status || "queued"
  };
}
