function basicAuth(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

function channelTemplate() {
  if (process.env.ASTERISK_CHANNEL_TEMPLATE) return process.env.ASTERISK_CHANNEL_TEMPLATE;
  if (process.env.ASTERISK_TRUNK) return `PJSIP/{phone}@${process.env.ASTERISK_TRUNK}`;
  return "";
}

export function asteriskConfigured() {
  return Boolean(
    process.env.ASTERISK_ARI_URL &&
    process.env.ASTERISK_ARI_USER &&
    process.env.ASTERISK_ARI_PASSWORD &&
    channelTemplate()
  );
}

export function asteriskNetworkMode() {
  const template = channelTemplate();
  if (/^Mobile\//i.test(template)) return "cellphone_bluetooth";
  if (/^PJSIP\//i.test(template)) return "sip_pstn";
  return template ? "custom" : "unconfigured";
}

function prospectEndpoint(phone) {
  const normalized = String(phone || "").replace(/[^+\d]/g, "");
  if (!/^\+?\d{8,15}$/.test(normalized)) throw new Error("Prospect phone must be a valid dialable number");
  const template = channelTemplate();
  if (!template) throw new Error("Asterisk outbound channel template is not configured");
  if (!template.includes("{phone}")) throw new Error("ASTERISK_CHANNEL_TEMPLATE must contain {phone}");
  return template.replaceAll("{phone}", normalized);
}

export async function originateAsterisk({ phone, sessionId, callerId }) {
  if (!asteriskConfigured()) throw new Error("Asterisk ARI transport is not configured");
  const base = process.env.ASTERISK_ARI_URL.replace(/\/$/, "");
  const endpoint = prospectEndpoint(phone);
  const params = new URLSearchParams({
    endpoint,
    extension: process.env.ASTERISK_DIAL_EXTENSION || "start",
    context: process.env.ASTERISK_DIAL_CONTEXT || "ssag-ai-outbound",
    priority: "1",
    timeout: String(Number(process.env.ASTERISK_DIAL_TIMEOUT || 30))
  });
  // A SIP carrier may honor a verified external caller ID. A cellular/Bluetooth trunk
  // normally presents the SIM/line identity and may ignore this value.
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
  return { provider: "asterisk", networkMode: asteriskNetworkMode(), channelId: body.id || null, endpoint };
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
