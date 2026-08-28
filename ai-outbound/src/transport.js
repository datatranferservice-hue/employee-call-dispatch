function basicAuth(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

export function asteriskConfigured() {
  return Boolean(
    process.env.ASTERISK_ARI_URL &&
    process.env.ASTERISK_ARI_USER &&
    process.env.ASTERISK_ARI_PASSWORD &&
    process.env.ASTERISK_TRUNK
  );
}

export async function originateAsterisk({ phone, sessionId, callerId }) {
  if (!asteriskConfigured()) throw new Error("Asterisk ARI transport is not configured");
  const base = process.env.ASTERISK_ARI_URL.replace(/\/$/, "");
  const endpoint = `PJSIP/${String(phone).replace(/[^+\d]/g, "")}@${process.env.ASTERISK_TRUNK}`;
  const params = new URLSearchParams({
    endpoint,
    extension: process.env.ASTERISK_DIAL_EXTENSION || "start",
    context: process.env.ASTERISK_DIAL_CONTEXT || "ssag-ai-outbound",
    priority: "1",
    timeout: String(Number(process.env.ASTERISK_DIAL_TIMEOUT || 30))
  });
  if (callerId) params.set("callerId", callerId);

  const response = await fetch(`${base}/ari/channels?${params}`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(process.env.ASTERISK_ARI_USER, process.env.ASTERISK_ARI_PASSWORD),
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      variables: {
        SSAG_SESSION_ID: sessionId,
        SSAG_SOURCE: "sentinel-zero-ai-outbound"
      }
    })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Asterisk originate failed (${response.status}): ${text.slice(0, 500)}`);
  let body = {};
  try { body = JSON.parse(text); } catch {}
  return { provider: "asterisk", channelId: body.id || null, endpoint };
}

export async function originate({ transport, phone, sessionId, callerId }) {
  if (transport === "simulation") {
    return { provider: "simulation", channelId: `sim-${sessionId}` };
  }
  if (transport === "asterisk") {
    return originateAsterisk({ phone, sessionId, callerId });
  }
  throw new Error(`Unsupported transport: ${transport}`);
}
