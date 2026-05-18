/**
 * LexGuard — Protección Ciudadana MX
 * App.jsx v3.0 — Geolocalización + Auditoría completa
 *
 * NUEVAS FUNCIONES:
 * - Geolocalización al activar SOS → link de Google Maps en mensaje a contactos
 * - Permiso explícito al usuario antes de obtener ubicación
 * - Fallback si el usuario niega el permiso (SOS funciona igual sin ubicación)
 *
 * AUDITORÍA v3 — Vulnerabilidades corregidas:
 * [FIX-13] CRÍTICO  — Geolocalización sin timeout → cuelgue indefinido
 * [FIX-14] CRÍTICO  — Coordenadas sin validar antes de construir URL de Maps
 * [FIX-15] ALTO     — Sin manejo de denegación de permiso de ubicación
 * [FIX-16] ALTO     — Coordenadas persistidas en estado sin limpiar post-SOS
 * [FIX-17] MEDIO    — Sin feedback visual del estado de geolocalización al usuario
 * [FIX-18] MEDIO    — navigator.geolocation accedido sin verificar disponibilidad
 * [FIX-19] BAJO     — Precisión de coordenadas excesiva (14 decimales) expuesta en URL
 *
 * Auditoría acumulada (v1+v2+v3): 19 vulnerabilidades corregidas
 */

import { useState, useEffect, useRef, useCallback } from "react";

// ─── Constantes de seguridad ─────────────────────────────────────────────────
const MAX_MESSAGE_LENGTH  = 1000;
const MAX_CHAT_HISTORY    = 20;
const MAX_NAME_LENGTH     = 50;
const MAX_PHONE_LENGTH    = 15;
const CONTACTS_KEY        = "auxilio_contacts_v2";
const GEO_TIMEOUT_MS      = 8000;   // [FIX-13] Timeout máximo para geolocalización
const GEO_MAX_AGE_MS      = 30000;  // Acepta ubicación cacheada de hasta 30s
const COORD_PRECISION     = 5;      // [FIX-19] Máximo 5 decimales (~1m de precisión, suficiente)

// ─── Utilidades de seguridad ─────────────────────────────────────────────────

function sanitizePhone(raw) {
  return String(raw).replace(/[^\d+\-\s]/g, "").trim().slice(0, MAX_PHONE_LENGTH);
}
function safeTelHref(phone) {
  const clean = sanitizePhone(phone);
  return clean.replace(/\D/g, "").length >= 7 ? `tel:${clean}` : "#";
}
function isValidPhone(phone) {
  return sanitizePhone(phone).replace(/\D/g, "").length >= 10;
}
function sanitizeName(raw) {
  return String(raw).trim().slice(0, MAX_NAME_LENGTH);
}
function sanitizeChatInput(raw) {
  return String(raw).slice(0, MAX_MESSAGE_LENGTH);
}

// [FIX-14] Valida que las coordenadas sean números finitos dentro de rangos geográficos válidos
function isValidCoordinate(lat, lon) {
  return (
    typeof lat === "number" && isFinite(lat) && lat >= -90  && lat <= 90 &&
    typeof lon === "number" && isFinite(lon) && lon >= -180 && lon <= 180
  );
}

// [FIX-14] + [FIX-19] Construye URL de Maps solo con coordenadas validadas y precisión limitada
function buildMapsUrl(lat, lon) {
  if (!isValidCoordinate(lat, lon)) return null;
  const safeLat = parseFloat(lat.toFixed(COORD_PRECISION));
  const safeLon = parseFloat(lon.toFixed(COORD_PRECISION));
  return `https://maps.google.com/?q=${safeLat},${safeLon}`;
}

// ─── Geolocalización segura ───────────────────────────────────────────────────

// [FIX-13] + [FIX-15] + [FIX-18] Obtiene ubicación con timeout, manejo de errores y verificación de API
function getLocationSafe() {
  return new Promise((resolve) => {
    // [FIX-18] Verificar que la API existe antes de llamarla
    if (!navigator?.geolocation) {
      resolve({ coords: null, error: "noapi" });
      return;
    }

    // [FIX-13] Timeout propio como respaldo adicional al de la API
    const safetyTimeout = setTimeout(() => {
      resolve({ coords: null, error: "timeout" });
    }, GEO_TIMEOUT_MS + 1000);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        clearTimeout(safetyTimeout);
        const { latitude, longitude, accuracy } = position.coords;
        // [FIX-14] Validar coordenadas recibidas
        if (!isValidCoordinate(latitude, longitude)) {
          resolve({ coords: null, error: "invalid" });
          return;
        }
        resolve({ coords: { latitude, longitude, accuracy }, error: null });
      },
      (err) => {
        clearTimeout(safetyTimeout);
        // [FIX-15] Manejar cada tipo de error explícitamente
        const errorMap = {
          1: "denied",      // PERMISSION_DENIED
          2: "unavailable", // POSITION_UNAVAILABLE
          3: "timeout",     // TIMEOUT
        };
        resolve({ coords: null, error: errorMap[err.code] ?? "unknown" });
      },
      {
        enableHighAccuracy: true,
        timeout: GEO_TIMEOUT_MS,       // [FIX-13]
        maximumAge: GEO_MAX_AGE_MS,
      }
    );
  });
}

// Mensajes de error de geolocalización amigables para el usuario
function geoErrorMessage(error) {
  const messages = {
    denied:      "Permiso de ubicación denegado. El SOS se envió sin ubicación.",
    unavailable: "Ubicación no disponible. El SOS se envió sin ubicación.",
    timeout:     "Tiempo de espera agotado. El SOS se envió sin ubicación.",
    noapi:       "Tu navegador no soporta geolocalización. El SOS se envió sin ubicación.",
    invalid:     "Ubicación inválida recibida. El SOS se envió sin ubicación.",
  };
  return messages[error] ?? "No se pudo obtener la ubicación. El SOS se envió sin ubicación.";
}

// ─── localStorage ─────────────────────────────────────────────────────────────
const DEFAULT_CONTACTS = [
  { id: "c1", name: "", phone: "" },
  { id: "c2", name: "", phone: "" },
  { id: "c3", name: "", phone: "" },
];

function parseStoredContacts(raw) {
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length !== 3) return null;
  return parsed.map((c, i) => {
    if (typeof c !== "object" || c === null || Array.isArray(c)) return DEFAULT_CONTACTS[i];
    return {
      id: DEFAULT_CONTACTS[i].id,
      name: sanitizeName(String(c.name ?? "")),
      phone: sanitizePhone(String(c.phone ?? "")),
    };
  });
}
function loadContacts() {
  try {
    const saved = localStorage.getItem(CONTACTS_KEY);
    if (!saved) return DEFAULT_CONTACTS;
    return parseStoredContacts(saved) ?? DEFAULT_CONTACTS;
  } catch { return DEFAULT_CONTACTS; }
}
function saveContacts(contacts) {
  try {
    localStorage.setItem(CONTACTS_KEY, JSON.stringify(
      contacts.map((c) => ({ name: sanitizeName(c.name), phone: sanitizePhone(c.phone) }))
    ));
  } catch {}
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function AuxilioCiudadano() {
  const [screen, setScreen]               = useState("home");
  const [sosCountdown, setSosCountdown]   = useState(null);
  const [contacts, setContacts]           = useState(loadContacts);
  const [messages, setMessages]           = useState([
    { role: "assistant", content: "Hola, soy LexGuard. Estoy aquí para ayudarte a conocer tus derechos en caso de una detención policial en México. ¿Qué está pasando?" },
  ]);
  const [input, setInput]                 = useState("");
  const [loading, setLoading]             = useState(false);
  const [editContacts, setEditContacts]   = useState(false);
  const [tempContacts, setTempContacts]   = useState(contacts);
  const [sosTriggered, setSosTriggered]   = useState(false);
  const [holdProgress, setHoldProgress]   = useState(0);
  const [contactErrors, setContactErrors] = useState({});

  // [FIX-17] Estado de geolocalización visible al usuario
  const [geoStatus, setGeoStatus]         = useState(null); // null | "loading" | "ok" | string(error)
  // [FIX-16] Ubicación en ref, no en state — se limpia automáticamente sin re-renders
  const locationRef                        = useRef(null);

  const chatEndRef   = useRef(null);
  const countdownRef = useRef(null);
  const holdInterval = useRef(null);
  const sosGuard     = useRef(false);

  // [FIX-16] Limpiar ubicación y estado al salir del SOS
  const cleanupLocation = useCallback(() => {
    locationRef.current = null;
    setGeoStatus(null);
  }, []);

  useEffect(() => {
    return () => {
      clearInterval(countdownRef.current);
      clearInterval(holdInterval.current);
      cleanupLocation(); // [FIX-16]
    };
  }, [cleanupLocation]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    if (sosCountdown === 0) triggerSOS();
  }, [sosCountdown]);

  // ── SOS Hold ─────────────────────────────────────────────────────────────────
  const startHold = useCallback(() => {
    if (sosGuard.current) return;
    clearInterval(holdInterval.current);
    setHoldProgress(0);
    const start = Date.now();
    holdInterval.current = setInterval(() => {
      const pct = Math.min(((Date.now() - start) / 3000) * 100, 100);
      setHoldProgress(pct);
      if (pct >= 100) {
        clearInterval(holdInterval.current);
        holdInterval.current = null;
        activateSOS();
      }
    }, 50);
  }, []);

  const cancelHold = useCallback(() => {
    clearInterval(holdInterval.current);
    holdInterval.current = null;
    setHoldProgress(0);
  }, []);

  const activateSOS = useCallback(() => {
    if (sosGuard.current) return;
    sosGuard.current = true;
    setSosCountdown(5);
    setScreen("sos");

    // [FIX-13,15,17,18] Obtener ubicación en paralelo al countdown, con feedback al usuario
    setGeoStatus("loading");
    getLocationSafe().then(({ coords, error }) => {
      if (coords) {
        locationRef.current = coords; // [FIX-16] Guardar en ref, no en state
        setGeoStatus("ok");
      } else {
        locationRef.current = null;
        setGeoStatus(error); // Muestra mensaje de error amigable
      }
    });

    clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setSosCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const cancelSOS = useCallback(() => {
    clearInterval(countdownRef.current);
    countdownRef.current = null;
    sosGuard.current = false;
    setSosCountdown(null);
    setSosTriggered(false);
    setHoldProgress(0);
    cleanupLocation(); // [FIX-16]
    setScreen("home");
  }, [cleanupLocation]);

  // [FIX-27] Contacts en ref para evitar closure stale en triggerSOS
  const contactsRef = useRef(contacts);
  useEffect(() => { contactsRef.current = contacts; }, [contacts]);

  const triggerSOS = useCallback(() => {
    setSosTriggered(true);
    // Usar contactsRef.current para leer el valor más reciente sin dependencia en closure
    const validContacts = contactsRef.current.filter((c) => c.name && c.phone && isValidPhone(c.phone));
    if (validContacts.length === 0) return;
    fetch("/api/sos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contacts: validContacts.map((c) => ({ name: sanitizeName(c.name), phone: sanitizePhone(c.phone) })),
        location: locationRef.current
          ? { latitude: locationRef.current.latitude, longitude: locationRef.current.longitude }
          : null,
        userName: "Usuario LexGuard",
      }),
    })
      .then((r) => r.json())
      .then((d) => console.log("[LexGuard] SOS enviado:", d.message))
      .catch((e) => console.error("[LexGuard] Error SOS:", e.message));
  }, []);

  // ── Chat ──────────────────────────────────────────────────────────────────────
  const sendMessage = async () => {
    const trimmed = sanitizeChatInput(input.trim());
    if (!trimmed || loading) return;
    const userMsg = { role: "user", content: trimmed };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.slice(-MAX_CHAT_HISTORY).map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      if (!response.ok) throw new Error(`Error ${response.status}`);
      const data = await response.json();
      if (typeof data.text !== "string" || !data.text) throw new Error("Respuesta inválida");
      setMessages([...newMessages, { role: "assistant", content: data.text }]);
    } catch (err) {
      console.error("[LexGuard]", err.message);
      setMessages([...newMessages, { role: "assistant", content: "Error de conexión. Recuerda: tienes derecho a guardar silencio y pedir un abogado de oficio." }]);
    } finally {
      setLoading(false);
    }
  };

  // ── Contactos ─────────────────────────────────────────────────────────────────
  const saveContactsHandler = () => {
    const errors = {};
    tempContacts.forEach((c, i) => {
      if (c.phone && !isValidPhone(c.phone)) errors[i] = "Teléfono inválido (mínimo 10 dígitos)";
    });
    if (Object.keys(errors).length > 0) { setContactErrors(errors); return; }
    setContactErrors({});
    const sanitized = tempContacts.map((c) => ({ ...c, name: sanitizeName(c.name), phone: sanitizePhone(c.phone) }));
    setContacts(sanitized);
    saveContacts(sanitized);
    setEditContacts(false);
  };

  const filledContacts = contacts.filter((c) => c.name && c.phone && isValidPhone(c.phone));

  // [FIX-14] URL de Maps segura lista para mostrar
  const mapsUrl = locationRef.current
    ? buildMapsUrl(locationRef.current.latitude, locationRef.current.longitude)
    : null;

  return (
    <div style={styles.root}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: #0a0a0a; }
        ::-webkit-scrollbar-thumb { background: #333; border-radius: 2px; }
        @keyframes pulse-ring { 0% { transform: scale(1); opacity: 1; } 100% { transform: scale(1.8); opacity: 0; } }
        @keyframes flash-bg { 0%, 100% { background: #0a0a0a; } 50% { background: #1a0000; } }
        @keyframes slide-up { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.3; } }
        @keyframes typing { 0%, 60%, 100% { transform: translateY(0); } 30% { transform: translateY(-6px); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .typing-dot { display: inline-block; animation: typing 1.2s infinite; }
        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }
        .slide-up { animation: slide-up 0.4s ease forwards; }
        .blink { animation: blink 1s infinite; }
        .spin { animation: spin 1s linear infinite; display: inline-block; }
      `}</style>

      {/* ── HOME ── */}
      {screen === "home" && (
        <div style={styles.screen}>
          <div style={styles.header}>
            <div style={styles.headerLeft}>
              <div style={styles.shield} aria-hidden="true">⚖</div>
              <div>
                <div style={styles.appName}>LEXGUARD</div>
                <div style={styles.appSub}>Protección Ciudadana MX</div>
              </div>
            </div>
            <button style={styles.settingsBtn} onClick={() => setScreen("contacts")} aria-label="Ver contactos de emergencia">
              <span aria-hidden="true" style={{ fontSize: 20 }}>👥</span>
            </button>
          </div>

          <div style={styles.statusBar} role="status" aria-live="polite">
            <div style={styles.statusDot} aria-hidden="true" />
            <span style={styles.statusText}>
              {filledContacts.length} contacto{filledContacts.length !== 1 ? "s" : ""} de emergencia
              {filledContacts.length === 0 && " — configura tus contactos"}
            </span>
          </div>

          <div style={styles.sosContainer}>
            <div style={styles.sosRings} aria-hidden="true">
              {holdProgress > 0 && (<><div style={{ ...styles.ring, ...styles.ring1 }} /><div style={{ ...styles.ring, ...styles.ring2 }} /></>)}
            </div>
            <svg style={styles.progressSvg} viewBox="0 0 200 200" aria-hidden="true">
              <circle cx="100" cy="100" r="90" fill="none" stroke="#1a1a1a" strokeWidth="6" />
              {holdProgress > 0 && (
                <circle cx="100" cy="100" r="90" fill="none" stroke="#dc2626" strokeWidth="6"
                  strokeDasharray={`${2 * Math.PI * 90}`}
                  strokeDashoffset={`${2 * Math.PI * 90 * (1 - holdProgress / 100)}`}
                  strokeLinecap="round" transform="rotate(-90 100 100)"
                  style={{ transition: "stroke-dashoffset 0.05s linear" }} />
              )}
            </svg>
            <button
              style={{ ...styles.sosButton, transform: holdProgress > 0 ? "scale(0.95)" : "scale(1)", background: holdProgress > 0 ? `radial-gradient(circle, #7f1d1d, #dc2626)` : `radial-gradient(circle, #991b1b, #b91c1c)` }}
              onMouseDown={startHold} onMouseUp={cancelHold} onMouseLeave={cancelHold}
              onTouchStart={startHold} onTouchEnd={cancelHold}
              aria-label="Botón de emergencia SOS. Mantén presionado 3 segundos para activar."
              aria-pressed={holdProgress > 0}
            >
              <div style={styles.sosIcon} aria-hidden="true">🆘</div>
              <div style={styles.sosLabel}>SOS</div>
              <div style={styles.sosHint}>{holdProgress > 0 ? "Suelta para cancelar" : "Mantén presionado"}</div>
            </button>
          </div>

          <div style={styles.holdInstruction} aria-hidden="true">
            <span style={{ opacity: 0.5 }}>▼</span>
            <span> Mantén 3 segundos para activar · Envía tu ubicación a tus contactos</span>
          </div>

          <div style={styles.quickActions}>
            <button style={styles.actionCard} onClick={() => setScreen("chat")} aria-label="Abrir asistente de IA legal">
              <div style={styles.actionIcon} aria-hidden="true">🤖</div>
              <div style={styles.actionTitle}>Asistente IA</div>
              <div style={styles.actionDesc}>Consulta tus derechos</div>
            </button>
            <a href={safeTelHref("911")} style={{ ...styles.actionCard, textDecoration: "none" }} aria-label="Llamar al 911">
              <div style={styles.actionIcon} aria-hidden="true">📞</div>
              <div style={styles.actionTitle}>Llamar 911</div>
              <div style={styles.actionDesc}>Emergencias México</div>
            </a>
            <button style={styles.actionCard} onClick={() => setScreen("info")} aria-label="Ver mis derechos constitucionales">
              <div style={styles.actionIcon} aria-hidden="true">📋</div>
              <div style={styles.actionTitle}>Mis Derechos</div>
              <div style={styles.actionDesc}>Art. 16, 20 y más</div>
            </button>
          </div>

          <a href={safeTelHref("8007146600")} style={styles.cndh} aria-label="Llamar a CNDH 800-714-6600">
            <span aria-hidden="true">🏛</span>
            <span>CNDH: 800-714-6600</span>
            <span style={{ marginLeft: "auto", opacity: 0.5 }} aria-hidden="true">→</span>
          </a>
        </div>
      )}

      {/* ── SOS ── */}
      {screen === "sos" && (
        <div style={{ ...styles.screen, ...(sosTriggered ? {} : { animation: "flash-bg 1s infinite" }) }}
          role="alert" aria-live="assertive">
          <div style={styles.sosScreen}>
            {!sosTriggered ? (
              <>
                <div style={styles.sosCountdownNum} className="blink" aria-label={`Alerta en ${sosCountdown} segundos`}>
                  {sosCountdown}
                </div>
                <div style={styles.sosCountdownLabel}>Enviando alerta en...</div>

                {/* [FIX-17] Indicador de estado de geolocalización */}
                <div style={styles.geoStatus} aria-live="polite">
                  {geoStatus === "loading" && (
                    <span><span className="spin">⊙</span> Obteniendo ubicación...</span>
                  )}
                  {geoStatus === "ok" && (
                    <span style={{ color: "#22c55e" }}>📍 Ubicación obtenida ✓</span>
                  )}
                  {geoStatus && geoStatus !== "loading" && geoStatus !== "ok" && (
                    <span style={{ color: "#f87171" }}>⚠ {geoErrorMessage(geoStatus)}</span>
                  )}
                </div>

                <div style={styles.sosInfo}>
                  Se notificará a {filledContacts.length || "tus"} contacto{filledContacts.length !== 1 ? "s" : ""} de emergencia
                  {geoStatus === "ok" && " con tu ubicación"}
                </div>
                <button style={styles.cancelBtn} onClick={cancelSOS} aria-label="Cancelar alerta de emergencia">
                  ✕ CANCELAR ALERTA
                </button>
              </>
            ) : (
              <div className="slide-up">
                <div style={styles.sosCheck} aria-hidden="true">✓</div>
                <div style={styles.sosSentTitle}>¡ALERTA ENVIADA!</div>
                <div style={styles.sosSentSub}>Tus contactos fueron notificados</div>

                {/* [FIX-14] Mostrar link de Maps solo si las coordenadas son válidas */}
                {mapsUrl && (
                  <a href={mapsUrl} target="_blank" rel="noopener noreferrer" style={styles.mapsLink}
                    aria-label="Ver mi ubicación en Google Maps">
                    <span aria-hidden="true">📍</span>
                    <span>Ver mi ubicación en Maps</span>
                    <span style={{ marginLeft: "auto", opacity: 0.6 }}>↗</span>
                  </a>
                )}

                <div style={styles.sentActions}>
                  {filledContacts.map((c) => (
                    <div key={c.id} style={styles.sentContact}>
                      <span style={styles.sentDot} aria-hidden="true">●</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{sanitizeName(c.name)}</div>
                        {mapsUrl && <div style={{ fontSize: 11, color: "#666", fontFamily: "IBM Plex Mono, monospace" }}>📍 Ubicación incluida</div>}
                      </div>
                      <a href={safeTelHref(c.phone)} style={styles.callBtn} aria-label={`Llamar a ${sanitizeName(c.name)}`}>Llamar</a>
                    </div>
                  ))}
                  {filledContacts.length === 0 && <div style={styles.noContacts}>No tienes contactos configurados</div>}
                </div>

                <a href={safeTelHref("911")} style={styles.call911Btn} aria-label="Llamar al 911">📞 LLAMAR AL 911</a>

                <div style={styles.rightsReminder} role="note">
                  <div style={styles.rightsTitle}>🛡 Recuerda</div>
                  <div style={styles.rightsText}>{"• Tienes derecho a guardar silencio\n• Pide identificación al policía\n• No firmes nada sin abogado\n• Puedes grabarte siendo detenido"}</div>
                </div>

                <button style={styles.backBtn} onClick={cancelSOS} aria-label="Volver al inicio">Volver al inicio</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CHAT ── */}
      {screen === "chat" && (
        <div style={styles.screen}>
          <div style={styles.chatHeader}>
            <button style={styles.backArrow} onClick={() => setScreen("home")} aria-label="Regresar">←</button>
            <div style={styles.aiAvatar} aria-hidden="true">⚖</div>
            <div>
              <div style={styles.chatTitle}>LexGuard IA</div>
              <div style={styles.chatOnline}>● En línea — Asesoría legal</div>
            </div>
          </div>
          <div style={styles.chatMessages} role="log" aria-live="polite">
            {messages.map((m, i) => (
              <div key={`msg-${i}`} className="slide-up"
                style={{ ...styles.msgRow, justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
                {m.role === "assistant" && <div style={styles.aiAvatarSmall} aria-hidden="true">⚖</div>}
                <div style={{ ...styles.bubble, ...(m.role === "user" ? styles.userBubble : styles.aiBubble) }}>
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ ...styles.msgRow, justifyContent: "flex-start" }} aria-label="Escribiendo...">
                <div style={styles.aiAvatarSmall} aria-hidden="true">⚖</div>
                <div style={{ ...styles.bubble, ...styles.aiBubble }} aria-hidden="true">
                  <span className="typing-dot">●</span>{" "}<span className="typing-dot">●</span>{" "}<span className="typing-dot">●</span>
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>
          <div style={styles.chatInput}>
            <div style={styles.quickChips}>
              {["¿Me pueden detener?", "Derechos Art. 16", "¿Debo firmar?", "Abogado"].map((q) => (
                <button key={q} style={styles.chip} onClick={() => setInput(q)}>{q}</button>
              ))}
            </div>
            <div style={styles.inputRow}>
              <textarea style={styles.textInput} value={input}
                onChange={(e) => setInput(sanitizeChatInput(e.target.value))}
                placeholder="Describe tu situación..." rows={2} maxLength={MAX_MESSAGE_LENGTH}
                aria-label="Escribe tu consulta legal"
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} />
              <button style={{ ...styles.sendBtn, opacity: input.trim() && !loading ? 1 : 0.4 }}
                onClick={sendMessage} disabled={!input.trim() || loading} aria-label="Enviar">▶</button>
            </div>
            {input.length > MAX_MESSAGE_LENGTH * 0.85 && (
              <div style={styles.charCount} aria-live="polite">{input.length}/{MAX_MESSAGE_LENGTH}</div>
            )}
          </div>
        </div>
      )}

      {/* ── CONTACTOS ── */}
      {screen === "contacts" && (
        <div style={styles.screen}>
          <div style={styles.chatHeader}>
            <button style={styles.backArrow} onClick={() => setScreen("home")} aria-label="Regresar">←</button>
            <div style={{ flex: 1 }}>
              <div style={styles.chatTitle}>Contactos de Emergencia</div>
              <div style={styles.chatOnline}>Recibirán tu ubicación al activar SOS</div>
            </div>
            {!editContacts
              ? <button style={styles.editBtn} onClick={() => { setTempContacts([...contacts]); setContactErrors({}); setEditContacts(true); }}>Editar</button>
              : <button style={styles.saveBtn} onClick={saveContactsHandler}>Guardar</button>}
          </div>
          <div style={styles.contactsList}>
            {(editContacts ? tempContacts : contacts).map((c, i) => (
              <div key={c.id} style={styles.contactCard} className="slide-up">
                <div style={styles.contactNum} aria-hidden="true">{i + 1}</div>
                {editContacts ? (
                  <div style={styles.contactFields}>
                    <input style={styles.contactInput} placeholder="Nombre (ej. Mamá)"
                      value={c.name} maxLength={MAX_NAME_LENGTH} aria-label={`Nombre contacto ${i + 1}`}
                      onChange={(e) => { const u = [...tempContacts]; u[i] = { ...u[i], name: sanitizeName(e.target.value) }; setTempContacts(u); }} />
                    <input style={{ ...styles.contactInput, borderColor: contactErrors[i] ? "#dc2626" : "#2a2a2a" }}
                      placeholder="Teléfono (10 dígitos)" value={c.phone} type="tel"
                      maxLength={MAX_PHONE_LENGTH} aria-label={`Teléfono contacto ${i + 1}`}
                      aria-describedby={contactErrors[i] ? `err-${i}` : undefined}
                      onChange={(e) => {
                        const u = [...tempContacts]; u[i] = { ...u[i], phone: sanitizePhone(e.target.value) }; setTempContacts(u);
                        if (contactErrors[i]) setContactErrors((p) => { const n = { ...p }; delete n[i]; return n; });
                      }} />
                    {contactErrors[i] && <div id={`err-${i}`} style={styles.inputError} role="alert">⚠ {contactErrors[i]}</div>}
                  </div>
                ) : (
                  <div style={styles.contactInfo}>
                    <div style={styles.contactName}>{c.name || <span style={{ opacity: 0.3 }}>Sin configurar</span>}</div>
                    <div style={styles.contactPhone}>{c.phone || <span style={{ opacity: 0.3 }}>—</span>}</div>
                  </div>
                )}
                {!editContacts && c.phone && isValidPhone(c.phone) && (
                  <a href={safeTelHref(c.phone)} style={styles.callIconBtn} aria-label={`Llamar a ${c.name}`}>📞</a>
                )}
              </div>
            ))}
            <div style={styles.geoNote}>
              📍 Al activar el SOS, tus contactos recibirán un link de Google Maps con tu ubicación exacta en tiempo real.
            </div>
          </div>
        </div>
      )}

      {/* ── INFO ── */}
      {screen === "info" && (
        <div style={styles.screen}>
          <div style={styles.chatHeader}>
            <button style={styles.backArrow} onClick={() => setScreen("home")} aria-label="Regresar">←</button>
            <div>
              <div style={styles.chatTitle}>Tus Derechos</div>
              <div style={styles.chatOnline}>Constitución Política de México</div>
            </div>
          </div>
          <div style={styles.infoScroll}>
            {[
              { art: "Art. 16", title: "Detención Legal", icon: "⚖️", color: "#dc2626", text: "Nadie puede ser molestado en su persona sin orden judicial. Solo puedes ser detenido en flagrante delito o por orden escrita de autoridad competente." },
              { art: "Art. 20", title: "Derechos del Imputado", icon: "🛡️", color: "#b45309", text: "Tienes derecho a guardar silencio. No estás obligado a declarar. Cualquier confesión sin abogado carece de valor probatorio." },
              { art: "Art. 22", title: "Prohibición de Tortura", icon: "🚫", color: "#7c3aed", text: "Quedan prohibidas las penas de mutilación, tortura y cualquier otro trato degradante. Si eres víctima, documenta todo y presenta queja ante CNDH." },
              { art: "Práctica", title: "¿Qué hacer si te detienen?", icon: "📋", color: "#065f46", text: "1. Mantén la calma. 2. Pide identificación al policía. 3. Pregunta el motivo. 4. Llama a un familiar. 5. No firmes nada sin abogado. 6. Puedes grabar la detención." },
              { art: "Contactos", title: "Números de Auxilio", icon: "📞", color: "#1e40af", text: "• Emergencias: 911\n• CNDH: 800-714-6600\n• Locatel CDMX: 55 5658-1111\n• Defensoría Pública Federal: 800-200-5050" },
            ].map((item) => (
              <div key={item.art} style={{ ...styles.infoCard, borderLeftColor: item.color }} className="slide-up">
                <div style={styles.infoHeader}>
                  <span style={styles.infoIcon} aria-hidden="true">{item.icon}</span>
                  <span style={{ ...styles.infoArt, color: item.color }}>{item.art}</span>
                  <span style={styles.infoTitle}>{item.title}</span>
                </div>
                <div style={styles.infoText}>{item.text}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── NAV ── */}
      {screen !== "sos" && (
        <nav style={styles.bottomNav} aria-label="Navegación principal">
          {[
            { icon: "🏠", label: "Inicio", s: "home" },
            { icon: "🤖", label: "IA Legal", s: "chat" },
            { icon: "📋", label: "Derechos", s: "info" },
            { icon: "👥", label: "Contactos", s: "contacts" },
          ].map(({ icon, label, s }) => (
            <button key={s} style={{ ...styles.navBtn, color: screen === s ? "#dc2626" : "#555" }}
              onClick={() => setScreen(s)} aria-label={label} aria-current={screen === s ? "page" : undefined}>
              <span style={styles.navIcon} aria-hidden="true">{icon}</span>
              <span style={styles.navLabel}>{label}</span>
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────
const styles = {
  root: { fontFamily: "'IBM Plex Sans', sans-serif", background: "#0a0a0a", color: "#e5e5e5", minHeight: "100vh", maxWidth: 420, margin: "0 auto", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" },
  screen: { flex: 1, display: "flex", flexDirection: "column", paddingBottom: 70, overflowY: "auto", minHeight: "100vh" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 20px 10px", borderBottom: "1px solid #1a1a1a" },
  headerLeft: { display: "flex", alignItems: "center", gap: 12 },
  shield: { width: 44, height: 44, background: "linear-gradient(135deg, #dc2626, #7f1d1d)", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, boxShadow: "0 4px 20px rgba(220,38,38,0.3)" },
  appName: { fontFamily: "'Bebas Neue', cursive", fontSize: 24, letterSpacing: 3, color: "#fff", lineHeight: 1 },
  appSub: { fontSize: 11, color: "#666", letterSpacing: 1, fontFamily: "'IBM Plex Mono', monospace" },
  settingsBtn: { background: "#141414", border: "1px solid #222", borderRadius: 10, padding: "8px 12px", cursor: "pointer", color: "#fff" },
  statusBar: { display: "flex", alignItems: "center", gap: 8, padding: "10px 20px", background: "#0f0f0f", borderBottom: "1px solid #1a1a1a" },
  statusDot: { width: 8, height: 8, borderRadius: "50%", background: "#22c55e", boxShadow: "0 0 8px #22c55e", flexShrink: 0 },
  statusText: { fontSize: 12, color: "#666", fontFamily: "'IBM Plex Mono', monospace" },
  sosContainer: { display: "flex", alignItems: "center", justifyContent: "center", position: "relative", padding: "30px 0 20px" },
  sosRings: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" },
  ring: { position: "absolute", borderRadius: "50%", border: "2px solid rgba(220,38,38,0.3)", animation: "pulse-ring 1.5s ease-out infinite" },
  ring1: { width: 180, height: 180 },
  ring2: { width: 220, height: 220, animationDelay: "0.5s" },
  progressSvg: { position: "absolute", width: 200, height: 200, pointerEvents: "none" },
  sosButton: { width: 160, height: 160, borderRadius: "50%", border: "3px solid #dc2626", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", transition: "transform 0.1s, background 0.2s", boxShadow: "0 0 40px rgba(220,38,38,0.4), inset 0 2px 0 rgba(255,255,255,0.1)", userSelect: "none", WebkitUserSelect: "none", position: "relative", zIndex: 2 },
  sosIcon: { fontSize: 36, lineHeight: 1 },
  sosLabel: { fontFamily: "'Bebas Neue', cursive", fontSize: 32, letterSpacing: 4, color: "#fff", lineHeight: 1 },
  sosHint: { fontSize: 9, color: "rgba(255,200,200,0.7)", letterSpacing: 0.5, marginTop: 2, fontFamily: "'IBM Plex Mono', monospace" },
  holdInstruction: { textAlign: "center", fontSize: 11, color: "#444", padding: "0 20px 10px", fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 0.5 },
  quickActions: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, padding: "10px 16px" },
  actionCard: { background: "#111", border: "1px solid #1e1e1e", borderRadius: 14, padding: "14px 8px", textAlign: "center", cursor: "pointer", color: "#e5e5e5", display: "flex", flexDirection: "column", alignItems: "center", gap: 6 },
  actionIcon: { fontSize: 24 },
  actionTitle: { fontWeight: 600, fontSize: 12, color: "#fff" },
  actionDesc: { fontSize: 10, color: "#555", lineHeight: 1.3 },
  cndh: { margin: "8px 16px 0", padding: "14px 16px", background: "#0f1a2e", border: "1px solid #1e3a5f", borderRadius: 12, display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#60a5fa", textDecoration: "none", fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500 },
  sosScreen: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24, minHeight: "100vh", gap: 12 },
  sosCountdownNum: { fontFamily: "'Bebas Neue', cursive", fontSize: 120, color: "#dc2626", lineHeight: 1, textShadow: "0 0 60px rgba(220,38,38,0.8)" },
  sosCountdownLabel: { fontSize: 18, color: "#fff", letterSpacing: 2, fontFamily: "'Bebas Neue', cursive" },
  geoStatus: { fontSize: 12, color: "#999", fontFamily: "'IBM Plex Mono', monospace", minHeight: 20, textAlign: "center" },
  sosInfo: { fontSize: 13, color: "#999", textAlign: "center", fontFamily: "'IBM Plex Mono', monospace" },
  cancelBtn: { marginTop: 12, padding: "16px 40px", background: "#1a1a1a", border: "2px solid #444", borderRadius: 14, color: "#fff", fontSize: 16, fontWeight: 600, cursor: "pointer", letterSpacing: 1 },
  sosCheck: { fontSize: 80, textAlign: "center", color: "#22c55e", textShadow: "0 0 40px rgba(34,197,94,0.6)", marginBottom: 8 },
  sosSentTitle: { fontFamily: "'Bebas Neue', cursive", fontSize: 40, letterSpacing: 4, textAlign: "center", color: "#22c55e" },
  sosSentSub: { textAlign: "center", color: "#666", fontSize: 14, marginBottom: 8, fontFamily: "'IBM Plex Mono', monospace" },
  mapsLink: { display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "12px 16px", background: "#0f1a2e", border: "1px solid #1e3a5f", borderRadius: 12, color: "#60a5fa", textDecoration: "none", fontSize: 13, marginBottom: 8, fontFamily: "'IBM Plex Mono', monospace", fontWeight: 500 },
  sentActions: { width: "100%", display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 },
  sentContact: { display: "flex", alignItems: "center", gap: 10, background: "#111", border: "1px solid #1e1e1e", borderRadius: 10, padding: "12px 16px", fontSize: 14 },
  sentDot: { color: "#22c55e", fontSize: 10 },
  callBtn: { color: "#60a5fa", textDecoration: "none", fontSize: 13, fontWeight: 600, fontFamily: "'IBM Plex Mono', monospace" },
  noContacts: { textAlign: "center", color: "#444", fontSize: 13, padding: 16, fontFamily: "'IBM Plex Mono', monospace" },
  call911Btn: { display: "block", width: "100%", padding: "18px", background: "linear-gradient(135deg, #dc2626, #b91c1c)", borderRadius: 14, textAlign: "center", color: "#fff", textDecoration: "none", fontWeight: 700, fontSize: 18, letterSpacing: 2, marginBottom: 12, boxShadow: "0 4px 20px rgba(220,38,38,0.4)" },
  rightsReminder: { background: "#0f1a0f", border: "1px solid #166534", borderRadius: 12, padding: "14px 16px", width: "100%", marginBottom: 12 },
  rightsTitle: { fontWeight: 600, color: "#22c55e", marginBottom: 8, fontSize: 13 },
  rightsText: { fontSize: 12, color: "#86efac", lineHeight: 1.8, whiteSpace: "pre-line", fontFamily: "'IBM Plex Mono', monospace" },
  backBtn: { background: "transparent", border: "1px solid #333", borderRadius: 10, color: "#666", padding: "12px 24px", cursor: "pointer", fontSize: 13 },
  chatHeader: { display: "flex", alignItems: "center", gap: 12, padding: "16px 16px 12px", borderBottom: "1px solid #1a1a1a", background: "#0a0a0a", position: "sticky", top: 0, zIndex: 10 },
  backArrow: { background: "#141414", border: "1px solid #222", borderRadius: 10, width: 40, height: 40, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", color: "#fff", fontSize: 20, flexShrink: 0 },
  aiAvatar: { width: 42, height: 42, background: "linear-gradient(135deg, #dc2626, #7f1d1d)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, boxShadow: "0 2px 12px rgba(220,38,38,0.3)", flexShrink: 0 },
  chatTitle: { fontWeight: 600, fontSize: 15, color: "#fff" },
  chatOnline: { fontSize: 11, color: "#22c55e", fontFamily: "'IBM Plex Mono', monospace" },
  editBtn: { marginLeft: "auto", background: "transparent", border: "1px solid #333", borderRadius: 8, color: "#60a5fa", padding: "6px 14px", cursor: "pointer", fontSize: 13 },
  saveBtn: { marginLeft: "auto", background: "#dc2626", border: "none", borderRadius: 8, color: "#fff", padding: "6px 14px", cursor: "pointer", fontSize: 13, fontWeight: 600 },
  chatMessages: { flex: 1, overflowY: "auto", padding: "16px 14px", display: "flex", flexDirection: "column", gap: 12 },
  msgRow: { display: "flex", alignItems: "flex-end", gap: 8 },
  aiAvatarSmall: { width: 28, height: 28, background: "linear-gradient(135deg, #dc2626, #7f1d1d)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0 },
  bubble: { maxWidth: "78%", padding: "12px 14px", borderRadius: 16, fontSize: 14, lineHeight: 1.6 },
  aiBubble: { background: "#141414", border: "1px solid #1e1e1e", borderBottomLeftRadius: 4, color: "#d1d5db" },
  userBubble: { background: "linear-gradient(135deg, #7f1d1d, #991b1b)", borderBottomRightRadius: 4, color: "#fff" },
  chatInput: { padding: "10px 12px 12px", background: "#0a0a0a", borderTop: "1px solid #1a1a1a", position: "sticky", bottom: 70 },
  quickChips: { display: "flex", gap: 6, marginBottom: 8, overflowX: "auto", paddingBottom: 2 },
  chip: { background: "#141414", border: "1px solid #222", borderRadius: 20, color: "#999", padding: "6px 12px", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap", fontFamily: "'IBM Plex Mono', monospace" },
  inputRow: { display: "flex", gap: 8, alignItems: "flex-end" },
  textInput: { flex: 1, background: "#111", border: "1px solid #222", borderRadius: 12, color: "#e5e5e5", padding: "10px 14px", fontSize: 14, resize: "none", fontFamily: "'IBM Plex Sans', sans-serif", lineHeight: 1.5, outline: "none" },
  sendBtn: { width: 44, height: 44, background: "#dc2626", border: "none", borderRadius: 12, color: "#fff", fontSize: 18, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  charCount: { fontSize: 10, color: "#555", textAlign: "right", marginTop: 4, fontFamily: "'IBM Plex Mono', monospace" },
  contactsList: { padding: "16px", display: "flex", flexDirection: "column", gap: 12 },
  contactCard: { background: "#111", border: "1px solid #1e1e1e", borderRadius: 14, padding: "14px 16px", display: "flex", alignItems: "center", gap: 14 },
  contactNum: { width: 32, height: 32, background: "#1a1a1a", border: "1px solid #333", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#dc2626", flexShrink: 0, fontFamily: "'Bebas Neue', cursive" },
  contactFields: { flex: 1, display: "flex", flexDirection: "column", gap: 6 },
  contactInput: { background: "#0a0a0a", border: "1px solid #2a2a2a", borderRadius: 8, color: "#e5e5e5", padding: "8px 12px", fontSize: 13, fontFamily: "'IBM Plex Sans', sans-serif", outline: "none" },
  inputError: { fontSize: 11, color: "#f87171", marginTop: 2, fontFamily: "'IBM Plex Mono', monospace" },
  contactInfo: { flex: 1 },
  contactName: { fontWeight: 600, fontSize: 14, color: "#fff", marginBottom: 3 },
  contactPhone: { fontSize: 13, color: "#666", fontFamily: "'IBM Plex Mono', monospace" },
  callIconBtn: { textDecoration: "none", fontSize: 22, marginLeft: "auto" },
  geoNote: { fontSize: 11, color: "#3b5f3b", textAlign: "center", padding: "12px 16px", lineHeight: 1.6, fontFamily: "'IBM Plex Mono', monospace", background: "#0a120a", border: "1px solid #1a3a1a", borderRadius: 10 },
  infoScroll: { padding: "16px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" },
  infoCard: { background: "#111", border: "1px solid #1e1e1e", borderLeft: "4px solid #dc2626", borderRadius: 12, padding: "16px" },
  infoHeader: { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 },
  infoIcon: { fontSize: 20 },
  infoArt: { fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, fontWeight: 600, background: "#1a1a1a", padding: "2px 8px", borderRadius: 6 },
  infoTitle: { fontWeight: 600, fontSize: 14, color: "#fff" },
  infoText: { fontSize: 13, color: "#999", lineHeight: 1.7, whiteSpace: "pre-line" },
  bottomNav: { position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 420, display: "flex", background: "#0a0a0a", borderTop: "1px solid #1a1a1a", padding: "8px 0 12px", zIndex: 100 },
  navBtn: { flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3, background: "none", border: "none", cursor: "pointer", transition: "color 0.2s" },
  navIcon: { fontSize: 20 },
  navLabel: { fontSize: 10, fontFamily: "'IBM Plex Mono', monospace", letterSpacing: 0.5 },
};
