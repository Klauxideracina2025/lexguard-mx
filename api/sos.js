/**
 * api/sos.js — Vercel Serverless Function
 * Envía alertas de emergencia por:
 *   1. WhatsApp (mensaje con ubicación)
 *   2. Llamada de voz automática (TwiML)
 *
 * AUDITORÍA v4+v5 — Todas las correcciones aplicadas.
 */

const MAX_NAME_LEN   = 50;
const MAX_PHONE_LEN  = 15;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const TWILIO_TIMEOUT = 8000;

// ─── Rate limiting ────────────────────────────────────────────────────────────
const rateLimitMap = new Map();
const RATE_LIMIT   = 3;
const RATE_WINDOW  = 60 * 1000;

function isRateLimited(ip) {
  const now   = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_WINDOW };
  if (now > entry.resetAt) { rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW }); return false; }
  if (entry.count >= RATE_LIMIT) return true;
  entry.count++;
  rateLimitMap.set(ip, entry);
  return false;
}
function cleanRateLimit() {
  const now = Date.now();
  for (const [k, v] of rateLimitMap.entries()) { if (now > v.resetAt) rateLimitMap.delete(k); }
}

// ─── Sanitización ─────────────────────────────────────────────────────────────
function sanitizePhone(raw) {
  return String(raw).replace(/[^\d+\-\s]/g, "").trim().slice(0, MAX_PHONE_LEN);
}
function isValidPhone(phone) {
  return sanitizePhone(phone).replace(/\D/g, "").length >= 10;
}
function sanitizeName(raw) {
  return String(raw).trim().slice(0, MAX_NAME_LEN).replace(/[*_~`<>'"]/g, "");
}
function isValidCoord(lat, lon) {
  return (
    typeof lat === "number" && isFinite(lat) && lat >= -90  && lat <= 90 &&
    typeof lon === "number" && isFinite(lon) && lon >= -180 && lon <= 180
  );
}
function buildWhatsAppNumber(phone) {
  const digits = sanitizePhone(phone).replace(/\D/g, "");
  if (digits.startsWith("52") && digits.length === 12) return `whatsapp:+${digits}`;
  if (digits.length === 10) return `whatsapp:+52${digits}`;
  if (digits.startsWith("1") && digits.length === 11) return `whatsapp:+${digits}`;
  if (digits.length >= 10) return `whatsapp:+52${digits.slice(-10)}`;
  return null;
}
function buildVoiceNumber(phone) {
  const digits = sanitizePhone(phone).replace(/\D/g, "");
  if (digits.startsWith("52") && digits.length === 12) return `+${digits}`;
  if (digits.length === 10) return `+52${digits}`;
  if (digits.startsWith("1") && digits.length === 11) return `+${digits}`;
  if (digits.length >= 10) return `+52${digits.slice(-10)}`;
  return null;
}

// ─── Llamada con AbortController ─────────────────────────────────────────────
async function twilioFetch(url, formBody, accountSid, authToken) {
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), TWILIO_TIMEOUT);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64"),
      },
      body: formBody.toString(),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await response.json();
    return { ok: response.ok, data };
  } catch (err) {
    clearTimeout(timeoutId);
    return { ok: false, data: { message: err.name === "AbortError" ? "timeout" : "network_error" } };
  }
}

// ─── WhatsApp ─────────────────────────────────────────────────────────────────
async function sendWhatsApp(phone, message, accountSid, authToken, fromNumber) {
  const toWhatsApp = buildWhatsAppNumber(phone);
  if (!toWhatsApp) return { ok: false, reason: "invalid_phone_format" };

  const body = new URLSearchParams({ From: fromNumber, To: toWhatsApp, Body: message });
  const { ok, data } = await twilioFetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    body, accountSid, authToken
  );
  if (!ok) { console.error("[LexGuard] WhatsApp error:", data?.message); return { ok: false, reason: data?.message ?? "error" }; }
  return { ok: true, sid: data.sid };
}

// ─── Llamada de voz ───────────────────────────────────────────────────────────
async function sendVoiceCall(phone, voiceMessage, accountSid, authToken, fromPhone) {
  const toPhone = buildVoiceNumber(phone);
  if (!toPhone) return { ok: false, reason: "invalid_phone_format" };

  // TwiML: mensaje de voz leído por el sistema
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="es-MX" voice="Polly.Mia">
    ${voiceMessage}
  </Say>
  <Pause length="1"/>
  <Say language="es-MX" voice="Polly.Mia">
    ${voiceMessage}
  </Say>
</Response>`;

  const body = new URLSearchParams({
    From:  fromPhone,
    To:    toPhone,
    Twiml: twiml,
  });

  const { ok, data } = await twilioFetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
    body, accountSid, authToken
  );
  if (!ok) { console.error("[LexGuard] Voice error:", data?.message); return { ok: false, reason: data?.message ?? "error" }; }
  return { ok: true, sid: data.sid };
}

// ─── Handler principal ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  // Rate limiting
  cleanRateLimit();
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Demasiadas alertas. Espera un momento." });
  }

  // Credenciales Twilio
  const accountSid   = process.env.TWILIO_ACCOUNT_SID;
  const authToken    = process.env.TWILIO_AUTH_TOKEN;
  const fromWhatsApp = process.env.TWILIO_WHATSAPP_FROM; // whatsapp:+14155238886
  const fromPhone    = process.env.TWILIO_PHONE_FROM;    // +12XXXXXXXXX (número Twilio para llamadas)

  if (!accountSid || !authToken) {
    return res.status(500).json({ error: "Twilio no configurado" });
  }

  let contacts, location, userName;
  try {
    ({ contacts, location, userName } = req.body);
  } catch {
    return res.status(400).json({ error: "Body inválido" });
  }

  if (!Array.isArray(contacts) || contacts.length === 0) {
    return res.status(400).json({ error: "Se requieren contactos" });
  }

  // Construir mensajes
  const now      = new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  const date     = new Date().toLocaleDateString("es-MX");
  const safeName = sanitizeName(String(userName || "Un ciudadano"));

  let locationText    = "📍 Ubicación no disponible";
  let locationVoice   = "La ubicación no está disponible.";

  if (location && isValidCoord(location.latitude, location.longitude)) {
    const lat = parseFloat(location.latitude.toFixed(5));
    const lon = parseFloat(location.longitude.toFixed(5));
    locationText  = `📍 Ubicación: https://maps.google.com/?q=${lat},${lon}`;
    locationVoice = `Su ubicación GPS ha sido compartida en el mensaje de WhatsApp.`;
  }

  const whatsappMessage =
    `🆘 *ALERTA DE EMERGENCIA — LexGuard MX*\n\n` +
    `${safeName} ha activado el botón de auxilio.\n\n` +
    `${locationText}\n` +
    `⏰ ${now} hrs — ${date}\n\n` +
    `Por favor comunícate con esta persona de inmediato.\n\n` +
    `_LexGuard MX — Protección Ciudadana_`;

  // Texto para la llamada de voz — sin caracteres especiales
  const voiceScript =
    `Alerta de emergencia de LexGuard México. ` +
    `${safeName} ha activado el botón de auxilio y necesita ayuda urgente. ` +
    `${locationVoice} ` +
    `Por favor comunícate con esta persona de inmediato. ` +
    `Este mensaje fue enviado automáticamente por LexGuard México.`;

  const validContacts = contacts
    .filter((c) => c?.phone && isValidPhone(c.phone))
    .slice(0, 3);

  if (validContacts.length === 0) {
    return res.status(400).json({ error: "No hay contactos válidos" });
  }

  // Enviar WhatsApp + llamada en paralelo a cada contacto
  const allResults = await Promise.allSettled(
    validContacts.flatMap((c) => {
      const phone = sanitizePhone(c.phone);
      const tasks = [];

      // WhatsApp (si está configurado)
      if (fromWhatsApp) {
        tasks.push(
          sendWhatsApp(phone, whatsappMessage, accountSid, authToken, fromWhatsApp)
            .then((r) => ({ type: "whatsapp", phone, ...r }))
        );
      }

      // Llamada de voz (si está configurado)
      if (fromPhone) {
        tasks.push(
          sendVoiceCall(phone, voiceScript, accountSid, authToken, fromPhone)
            .then((r) => ({ type: "call", phone, ...r }))
        );
      }

      return tasks;
    })
  );

  const results        = allResults.map((r) => r.status === "fulfilled" ? r.value : { ok: false, reason: "exception" });
  const whatsappSent   = results.filter((r) => r.type === "whatsapp" && r.ok).length;
  const callsSent      = results.filter((r) => r.type === "call"      && r.ok).length;
  const total          = validContacts.length;

  return res.status(200).json({
    whatsappSent,
    callsSent,
    total,
    message:
      `✅ WhatsApp: ${whatsappSent}/${fromWhatsApp ? total : 0} — ` +
      `📞 Llamadas: ${callsSent}/${fromPhone ? total : 0}`,
  });
}
