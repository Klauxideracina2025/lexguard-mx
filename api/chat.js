/**
 * api/chat.js — Vercel Serverless Function
 * Proxy seguro entre el frontend y la API de Anthropic.
 * La API key NUNCA se expone al cliente.
 */

const SYSTEM_PROMPT = `Eres LexGuard, un asistente legal especializado en derechos ciudadanos durante detenciones policiales en México. Tu misión es proteger a los ciudadanos informándoles sobre sus derechos constitucionales de manera clara, directa y accesible.

DERECHOS CLAVE QUE DEBES CONOCER:
- Artículo 16 constitucional: Nadie puede ser detenido sin orden judicial, excepto en flagrante delito
- Derecho a saber el motivo de la detención inmediatamente
- Derecho a no declarar y a no autoincriminarse (Art. 20)
- Derecho a un abogado desde el momento de la detención
- Derecho a llamar a un familiar o persona de confianza
- Plazo máximo de 48 horas ante el Ministerio Público (puede extenderse a 96h en delincuencia organizada)
- Prohibición absoluta de tortura y maltrato (Art. 22)
- Derecho a intérprete si no habla español
- La detención arbitraria es un delito (abuso de autoridad)
- Puedes negarte a que revisen tu celular sin orden judicial
- Puedes grabarte siendo detenido - es legal
- QUEJA ante CNDH: 800-714-6600

REGLAS DE RESPUESTA:
- Responde SIEMPRE en español
- Sé directo, claro y empático - la persona puede estar asustada
- Proporciona pasos concretos y accionables
- Cita artículos constitucionales cuando sea relevante
- Si hay riesgo físico, prioriza la seguridad sobre los derechos
- Nunca aconsejes resistencia física a la policía
- Mantén respuestas concisas pero completas (máx 200 palabras)
- Si mencionan violencia o urgencia extrema, recuerda que tienen el botón de SOS activo`;

// Límites de seguridad
const MAX_MESSAGES    = 20;
const MAX_MSG_LENGTH  = 1000;
const ALLOWED_ORIGIN  = process.env.ALLOWED_ORIGIN || "*"; // En producción pon tu dominio

export default async function handler(req, res) {
  // ── CORS ──────────────────────────────────────────────────────────────────
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });

  // ── Validar API key configurada ───────────────────────────────────────────
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error("[LexGuard] ANTHROPIC_API_KEY no configurada");
    return res.status(500).json({ error: "Servidor no configurado correctamente" });
  }

  // ── Validar body ──────────────────────────────────────────────────────────
  let messages;
  try {
    ({ messages } = req.body);
  } catch {
    return res.status(400).json({ error: "Body inválido" });
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "Se requiere un array de mensajes" });
  }

  // ── Sanitizar y limitar mensajes ──────────────────────────────────────────
  const sanitized = messages
    .slice(-MAX_MESSAGES)                        // Máximo 20 mensajes
    .filter((m) => m && typeof m.content === "string" && m.content.trim())
    .map((m) => ({
      role: m.role === "user" ? "user" : "assistant",  // Solo roles válidos
      content: String(m.content).slice(0, MAX_MSG_LENGTH).trim(),
    }));

  if (sanitized.length === 0) {
    return res.status(400).json({ error: "Mensajes vacíos" });
  }

  // ── Llamada a Anthropic ───────────────────────────────────────────────────
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,                          // API key solo en el servidor
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: sanitized,
      }),
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      console.error("[LexGuard] Error Anthropic:", response.status, errData);
      return res.status(502).json({ error: "Error al contactar el servicio de IA" });
    }

    const data = await response.json();
    const text = data?.content?.[0]?.text;

    if (typeof text !== "string" || !text) {
      return res.status(502).json({ error: "Respuesta inválida del servicio de IA" });
    }

    return res.status(200).json({ text });

  } catch (err) {
    console.error("[LexGuard] Error interno:", err.message);
    return res.status(500).json({ error: "Error interno del servidor" });
  }
}
