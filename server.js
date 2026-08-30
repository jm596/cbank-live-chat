/**
 * cbank Live Chat — server
 *
 * Express + Socket.io backend that connects the client-facing chat widget
 * (public/widget.js) with the support agent dashboard (public/agent-dashboard.html).
 *
 * In-memory only: sessions and messages live in process memory and reset on
 * restart. Swap the `sessions` Map for a real database (Postgres, Redis, etc.)
 * before going to production — see README.md "Going to production".
 *
 * Also handles, on top of chat routing:
 * - IP-based geolocation (country/city) for each visitor
 * - Emailing a transcript to the visitor when an agent closes the conversation
 * - A WhatsApp Business (Meta Cloud API) channel that reuses the same FAQ
 *   bot content and lands in the same agent dashboard as web chat sessions
 * All of these features degrade gracefully when not configured (see .env.example).
 */

require("dotenv").config();

const express = require("express");
const http = require("http");
const https = require("https");
const path = require("path");
const { Server } = require("socket.io");
const { v4: uuidv4 } = require("uuid");
const nodemailer = require("nodemailer");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }, // tighten this to cbank's real domain(s) in production
});

const PORT = process.env.PORT || 3000;

app.use(express.json()); // needed to parse incoming WhatsApp webhook POST bodies
app.use(express.static(path.join(__dirname, "public")));

// ---- In-memory session store -----------------------------------------
// sessions: Map<sessionId, {
//   id, name, email, whatsapp, device, locale, channel: "web" | "whatsapp",
//   location: { ip, country, city },
//   status, createdAt, closedAt, messages: [], unread,
//   transcriptEmail: { status, sentAt?, error?, reason? } | null
// }>
const sessions = new Map();

// Index from WhatsApp phone number -> sessionId, so an incoming message from
// a returning number resumes the same conversation instead of starting a new
// one every time (mirrors what localStorage does for the web widget).
const whatsappSessions = new Map();
// Same idea for Instagram DMs, keyed by IGSID (Instagram-scoped sender id).
const instagramSessions = new Map();

// ---- FAQ bot store (seeded from the real cbank.ws / cbank.ws/support FAQ
// content, translated to es/en/pt) --------------------------------------
// In-memory, like everything else here — resets on restart. Agents manage
// this list live from the dashboard (add/edit/delete), broadcast to every
// connected client and agent via `faqs:list` so open widgets refresh too.
let faqs = [
  {
    id: uuidv4(),
    question: {
      es: "¿Qué es la CBank Card y dónde puedo usarla?",
      en: "What is the CBank Card and where can I use it?",
      pt: "O que é o CBank Card e onde posso usá-lo?",
    },
    answer: {
      es: "Es una tarjeta Visa respaldada por USDC/USDT. La usás en cualquier lugar donde se acepte Visa, online y en tiendas físicas, en todo el mundo. No requiere verificación de crédito.",
      en: "It's a Visa card backed by USDC/USDT. You can use it anywhere Visa is accepted, online and in-store, worldwide. No credit check required.",
      pt: "É um cartão Visa lastreado em USDC/USDT. Você o usa em qualquer lugar que aceite Visa, online e em lojas físicas, no mundo todo. Não exige verificação de crédito.",
    },
  },
  {
    id: uuidv4(),
    question: {
      es: "¿Cómo creo una cuenta?",
      en: "How do I create an account?",
      pt: "Como crio uma conta?",
    },
    answer: {
      es: "Crear una cuenta de CBank Card es rápido y sencillo:\n• Descarga la app de CBank Card\n• Ingresa la información solicitada y sigue las indicaciones\n• Completa la verificación KYC para acceder a todas las funciones\n\n¡Una vez verificado, ya puedes usar tu CBank Card!",
      en: "Creating a CBank Card account is quick and easy:\n• Download the CBank Card app\n• Enter the requested information and follow the prompts\n• Complete KYC verification to access all features\n\nOnce verified, you can start using your CBank Card!",
      pt: "Criar uma conta CBank Card é rápido e fácil:\n• Baixe o aplicativo CBank Card\n• Insira as informações solicitadas e siga as instruções\n• Complete a verificação KYC para acessar todos os recursos\n\nDepois de verificado, você já pode usar seu CBank Card!",
    },
  },
  {
    id: uuidv4(),
    question: {
      es: "¿Cómo verifico mi identidad y cuánto tarda?",
      en: "How do I verify my identity and how long does it take?",
      pt: "Como verifico minha identidade e quanto tempo leva?",
    },
    answer: {
      es: "Completá el KYC en la app: nombre, documento y una selfie. La verificación es inmediata. Si se demora más de 5 minutos, contactá a soporte.",
      en: "Complete KYC in the app: name, ID, and a selfie. Verification is immediate. If it takes more than 5 minutes, contact support.",
      pt: "Complete o KYC no aplicativo: nome, documento e uma selfie. A verificação é imediata. Se demorar mais de 5 minutos, entre em contato com o suporte.",
    },
  },
  {
    id: uuidv4(),
    question: {
      es: "¿Hay algún costo?",
      en: "Are there any fees?",
      pt: "Existem taxas?",
    },
    answer: {
      es: "CBank Card mantiene los costos bajos:\n• Comisión de depósito: 0% (depósito mínimo de $2 USD)\n• Cuota mensual de la cuenta: $0\n• Emisión de tarjeta virtual: $0\n• Tarjeta física: $0\n• Envío de la tarjeta: $0",
      en: "CBank Card keeps fees low:\n• Deposit fee: 0% (minimum deposit $2 USD)\n• Monthly account fee: $0\n• Virtual card issuance: $0\n• Physical card: $0\n• Card shipping: $0",
      pt: "O CBank Card mantém as taxas baixas:\n• Taxa de depósito: 0% (depósito mínimo de $2 USD)\n• Mensalidade da conta: $0\n• Emissão do cartão virtual: $0\n• Cartão físico: $0\n• Envio do cartão: $0",
    },
  },
  {
    id: uuidv4(),
    question: {
      es: "¿Dónde descargo la app?",
      en: "Where can I download the app?",
      pt: "Onde eu baixo o aplicativo?",
    },
    answer: {
      es: "Links Descarga:\nGOOGLE PLAY :: https://play.google.com/store/apps/details?id=com.cbank.cbankapp\nAPPLE STORE :: https://apps.apple.com/uy/app/cbank-card/id6757606839",
      en: "Download links:\nGOOGLE PLAY :: https://play.google.com/store/apps/details?id=com.cbank.cbankapp\nAPPLE STORE :: https://apps.apple.com/uy/app/cbank-card/id6757606839",
      pt: "Links de download:\nGOOGLE PLAY :: https://play.google.com/store/apps/details?id=com.cbank.cbankapp\nAPPLE STORE :: https://apps.apple.com/uy/app/cbank-card/id6757606839",
    },
  },
  {
    id: uuidv4(),
    question: {
      es: "Cuentas Bancarias",
      en: "Bank Accounts",
      pt: "Contas Bancárias",
    },
    answer: {
      es: "Puedes crearte Cuentas Bancarias que funcionan como Rampas de FIAT en cada País. Las mismas sirven para Enviar y Recibir dinero en Moneda local del País de la cuenta. Ese $ se transforma a USDT y se acredita inmediatamente en tu Saldo de Tarjeta. Los Bancos tienen Costo de 1%. El tipo de Cambio utilizado en la punta Compradora del día.",
      en: "You can create Bank Accounts that work as FIAT ramps in each country. They let you send and receive money in the local currency of the account's country. That money is converted to USDT and credited immediately to your Card balance. Banks charge a 1% fee. The exchange rate used is the day's buy rate.",
      pt: "Você pode criar Contas Bancárias que funcionam como rampas de FIAT em cada país. Elas servem para enviar e receber dinheiro na moeda local do país da conta. Esse valor é convertido em USDT e creditado imediatamente no saldo do seu cartão. Os bancos cobram uma taxa de 1%. A taxa de câmbio utilizada é a cotação de compra do dia.",
    },
  },
  {
    id: uuidv4(),
    question: {
      es: "Rendimientos",
      en: "Yield",
      pt: "Rendimentos",
    },
    answer: {
      es: "Puedes invertir tu saldo de cuenta en un fondo que rinde 3% anual, se computa la ganancia diariamente pero se acredita todo junto cuando retiras la inversión. Muy pronto activamos rendimientos sobre el balance de Tarjeta, sin necesidad de colocar o congelar esos fondos.",
      en: "You can invest your account balance in a fund that yields 3% annually — earnings are calculated daily but credited all at once when you withdraw the investment. Very soon we'll activate yield on your Card balance, with no need to lock up or freeze those funds.",
      pt: "Você pode investir o saldo da sua conta em um fundo que rende 3% ao ano — o ganho é calculado diariamente, mas é creditado de uma vez quando você resgata o investimento. Em breve ativaremos rendimento sobre o saldo do cartão, sem necessidade de bloquear ou congelar esses fundos.",
    },
  },
  ];

// ---- Unanswered question log (free FAQ-learning loop) ------------------
// When a customer asks something that doesn't match any FAQ (web free-text
// or a WhatsApp message that isn't a menu number), we log it here instead of
// trying to auto-answer it. Agents review this list from the dashboard and
// can promote any entry straight into a permanent FAQ. In-memory, capped at
// 200 most-recent entries.
let unansweredQuestions = []; // { id, sessionId, sessionName, channel, text, locale, at }

function logUnansweredQuestion(session, text) {
  unansweredQuestions.unshift({
    id: uuidv4(),
    sessionId: session.id,
    sessionName: session.name,
    channel: session.channel || "web",
    text,
    locale: session.locale || "es",
    at: new Date().toISOString(),
  });
  if (unansweredQuestions.length > 200) unansweredQuestions.length = 200;
  io.to("agents").emit("unanswered:list", unansweredQuestions);
}

// ---- 2-minute no-reply escalation ---------------------------------------
// If nobody (agent) has replied to a client message within this window, the
// bot proactively steps in: offers the FAQ menu, tells the visitor they're
// next in line with an expected 1-3 minute delay, and pings the owner's own
// WhatsApp with the pending query so it doesn't get missed. One timer per
// session; every new unanswered client message restarts the clock, and it's
// cancelled the moment an agent actually replies or closes the chat.
const ESCALATION_DELAY_MS = 2 * 60 * 1000;
const OWNER_WHATSAPP = "59897982374";
const unansweredTimers = new Map(); // sessionId -> Timeout

const INFO_LINK_LINE = "Toda la Info >>> https://linktr.ee/cbank.ws";

const ESCALATION_COPY = {
  es: {
    waiting:
      "Gracias por tu paciencia \u{1F64F} Tu consulta es la próxima en ser respondida por un agente — puede haber una demora de 1 a 3 minutos. Mientras tanto, te dejamos las preguntas frecuentes por si te sirven:",
  },
  en: {
    waiting:
      "Thanks for your patience \u{1F64F} Your question is next in line to be answered by an agent — there may be a delay of 1 to 3 minutes. In the meantime, here are some frequently asked questions that might help:",
  },
  pt: {
    waiting:
      "Obrigado pela paciência \u{1F64F} Sua pergunta é a próxima a ser respondida por um agente — pode haver um atraso de 1 a 3 minutos. Enquanto isso, aqui estão algumas perguntas frequentes que podem ajudar:",
  },
};

function clearEscalationTimer(sessionId) {
  const timer = unansweredTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    unansweredTimers.delete(sessionId);
  }
}

function forwardQueryToOwnerWhatsApp(session, text) {
  const channelLabel =
    session.channel === "whatsapp" ? "WhatsApp" : session.channel === "instagram" ? "Instagram" : "Web";
  // Uses an approved template (not free-form text) because the owner's
  // number likely hasn't messaged the business number in the last 24h,
  // which would otherwise fail with Meta error 131047.
  sendWhatsAppTemplate(OWNER_WHATSAPP, "cbank_unanswered_query_alert", "es", [
    session.name || "Cliente",
    channelLabel,
    text || "(sin texto)",
  ]).catch((err) => {
    console.error("[cbank] Failed to forward unanswered query to owner WhatsApp:", err.message);
  });
}

function scheduleEscalation(session, triggerText) {
  clearEscalationTimer(session.id);
  const timer = setTimeout(() => {
    unansweredTimers.delete(session.id);
    const current = sessions.get(session.id);
    // Someone already replied, or the chat was closed in the meantime — nothing to do.
    if (!current || !current.needsReply || current.status === "closed") return;

    const copy = ESCALATION_COPY[current.locale] || ESCALATION_COPY.es;
    let botText = copy.waiting;
    if (current.channel === "whatsapp" || current.channel === "instagram") {
      const faqList = buildFaqListText(current.locale);
      if (faqList) botText += "\n\n" + faqList;
    }
    botText += "\n\n" + INFO_LINK_LINE;

    // `showFaq` rides along on the message itself (not a separate one-shot
    // socket event) so it survives a dropped/reconnecting connection: if the
    // live socket event is missed, the widget still picks it up when it
    // replays session history after reconnecting via client:joined.
    const message = {
      id: uuidv4(),
      from: "bot",
      text: botText,
      at: new Date().toISOString(),
      showFaq: current.channel !== "whatsapp" && current.channel !== "instagram",
    };
    current.messages.push(message);
    io.to(`session-${current.id}`).emit("message:new", message);

    if (current.channel === "whatsapp") {
      sendWhatsAppMessage(current.whatsapp, botText).catch((err) => {
        console.error("[cbank] Failed to deliver escalation message over WhatsApp:", err.message);
      });
    } else if (current.channel === "instagram") {
      sendInstagramMessage(current.instagramId, botText).catch((err) => {
        console.error("[cbank] Failed to deliver escalation message over Instagram:", err.message);
      });
    }

    // NOTE: the owner is already alerted the moment the query first arrived
    // (see forwardQueryToOwnerWhatsApp calls at the logUnansweredQuestion
    // call sites) — no second forward here, to avoid double-notifying.
    broadcastSessionList();
  }, ESCALATION_DELAY_MS);
  unansweredTimers.set(session.id, timer);
}

// ---- Email transcript templates (es/en/pt) ----------------------------
const EMAIL_TEMPLATES = {
  es: {
    subject: (date) => `Copia de tu conversación con cbank Support — ${date}`,
    intro: "Aquí tienes una copia de tu conversación con nuestro equipo de soporte:",
    from: "cbank Support",
  },
  en: {
    subject: (date) => `Your cbank Support conversation — ${date}`,
    intro: "Here's a copy of your conversation with our support team:",
    from: "cbank Support",
  },
  pt: {
    subject: (date) => `Cópia da sua conversa com o Suporte cbank — ${date}`,
    intro: "Aqui está uma cópia da sua conversa com nossa equipe de suporte:",
    from: "Suporte cbank",
  },
};

function sessionSummary(session) {
  const lastMessage = session.messages[session.messages.length - 1];
  return {
    id: session.id,
    name: session.name,
    email: session.email,
    whatsapp: session.whatsapp,
    device: session.device,
    channel: session.channel || "web",
    location: session.location,
    locale: session.locale,
    status: session.status,
    createdAt: session.createdAt,
    closedAt: session.closedAt || null,
    unread: session.unread || 0,
    needsReply: session.needsReply || false,
    lastMessage: lastMessage ? lastMessage.text : "",
    lastMessageAt: lastMessage ? lastMessage.at : session.createdAt,
    transcriptEmail: session.transcriptEmail || null,
  };
}

function broadcastSessionList() {
  const list = Array.from(sessions.values())
  .sort((a, b) => new Date(b.messages.at(-1)?.at || b.createdAt) - new Date(a.messages.at(-1)?.at || a.createdAt))
  .map(sessionSummary);
  io.to("agents").emit("sessions:list", list);
}

// ---- IP helpers ---------------------------------------------------------
function getClientIp(socket) {
  const forwarded = socket.handshake.headers["x-forwarded-for"];
  let ip = forwarded ? forwarded.split(",")[0].trim() : socket.handshake.address;
  if (ip && ip.startsWith("::ffff:")) ip = ip.slice(7);
  return ip || "unknown";
}

function isLocalOrPrivateIp(ip) {
  if (!ip || ip === "unknown") return true;
  if (ip === "::1" || ip === "127.0.0.1") return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  return false;
}

// ---- IP geolocation (free ip-api.com endpoint, cached per IP) ----------
// Rate-limited to ~45 req/min on the free tier — fine for small/medium
// traffic. Swap for a paid provider if you outgrow it.
const geoCache = new Map();

function geolocateIp(ip) {
  return new Promise((resolve) => {
    if (isLocalOrPrivateIp(ip)) {
      return resolve({ ip, country: "Local/Unknown", city: "Local/Unknown" });
    }
    if (geoCache.has(ip)) return resolve(geoCache.get(ip));

                     const req = http.get(
                       `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,city,query`,
                       { timeout: 4000 },
                       (res) => {
                         let data = "";
                         res.on("data", (chunk) => (data += chunk));
                         res.on("end", () => {
                           try {
                             const parsed = JSON.parse(data);
                             const result =
                               parsed.status === "success"
                             ? { ip: parsed.query || ip, country: parsed.country || "Unknown", city: parsed.city || "Unknown" }
                               : { ip, country: "Unknown", city: "Unknown" };
                             geoCache.set(ip, result);
                             resolve(result);
                           } catch (e) {
                             resolve({ ip, country: "Unknown", city: "Unknown" });
                           }
                         });
                       }
                       );
    req.on("timeout", () => {
      req.destroy();
      resolve({ ip, country: "Unknown", city: "Unknown" });
    });
    req.on("error", () => resolve({ ip, country: "Unknown", city: "Unknown" }));
  });
}

// ---- Outbound email (transcript on close) ------------------------------
// Configure via env vars (see .env.example). Falls back to logging a warning
// and marking the session as "not-configured" instead of crashing.
let mailer;
let mailerConfigured = null; // cache the configured/not-configured check

function getMailer() {
  if (mailerConfigured !== null) return mailerConfigured ? mailer : null;

const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) {
    mailerConfigured = false;
    console.warn(
      "[cbank] SMTP not configured (SMTP_HOST/SMTP_USER/SMTP_PASS) — transcript emails will be skipped. See .env.example."
      );
    return null;
  }

mailer = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(process.env.SMTP_PORT) || 587,
  secure: process.env.SMTP_SECURE === "true",
  auth: { user: SMTP_USER, pass: SMTP_PASS },
});
  mailerConfigured = true;
  return mailer;
}

function escapeHtml(str) {
  return String(str || "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
}

function whoLabel(from, clientName) {
  if (from === "client") return clientName;
  if (from === "agent") return "cbank Support";
  if (from === "bot") return "cbank Bot";
  return "System";
}

function renderTranscriptText(session) {
  return session.messages
  .map((m) => `[${new Date(m.at).toLocaleString()}] ${whoLabel(m.from, session.name)}: ${m.text}`)
  .join("\n");
}

function renderTranscriptHtml(session) {
  const rows = session.messages
  .map((m) => {
    const who = escapeHtml(whoLabel(m.from, session.name));
    const text = escapeHtml(m.text).replace(/\n/g, "<br/>");
    return `<p style="margin:0 0 10px;"><strong>${who}</strong> <span style="color:#888;font-size:12px;">${new Date(
      m.at
      ).toLocaleString()}</span><br/>${text}</p>`;
  })
  .join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;">${rows}</div>`;
}

function finalizeTranscriptStatus(session) {
  broadcastSessionList();
  io.to(`session-${session.id}`).emit("session:transcript-status", session.transcriptEmail);
}

async function sendTranscriptEmail(session) {
  if (!session.email) {
    session.transcriptEmail = { status: "skipped", reason: "El cliente no proporcionó email" };
    finalizeTranscriptStatus(session);
    return;
  }

const transporter = getMailer();
  if (!transporter) {
    session.transcriptEmail = { status: "not-configured" };
    finalizeTranscriptStatus(session);
    return;
  }

const tpl = EMAIL_TEMPLATES[session.locale] || EMAIL_TEMPLATES.es;
  const dateStr = new Date(session.createdAt).toLocaleDateString();

try {
  await transporter.sendMail({
    from: process.env.MAIL_FROM || `"${tpl.from}" <${process.env.SMTP_USER}>`,
    to: session.email,
    subject: tpl.subject(dateStr),
    text: `${tpl.intro}\n\n${renderTranscriptText(session)}`,
    html: `<p>${tpl.intro}</p>${renderTranscriptHtml(session)}`,
  });
  session.transcriptEmail = { status: "sent", sentAt: new Date().toISOString() };
} catch (err) {
  session.transcriptEmail = { status: "error", error: err.message };
}

finalizeTranscriptStatus(session);
}

// ---- WhatsApp Business (Meta Cloud API) --------------------------------
// Configure via env vars (see .env.example). Falls back to logging a
// warning and skipping the send when not configured, same pattern as email.
const WHATSAPP_API_VERSION = process.env.WHATSAPP_API_VERSION || "v22.0";

function whatsappConfigured() {
  return Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_ACCESS_TOKEN);
}

function sendWhatsAppMessage(to, text) {
  return new Promise((resolve, reject) => {
    if (!whatsappConfigured()) {
      console.warn(
        "[cbank] WhatsApp not configured (WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN) — message not sent. See .env.example."
        );
      return resolve(null);
    }

                     const payload = JSON.stringify({
                       messaging_product: "whatsapp",
                       to,
                       type: "text",
                       text: { body: text },
                     });

                     const req = https.request(
                       {
                         hostname: "graph.facebook.com",
                         path: `/${WHATSAPP_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
                         method: "POST",
                         headers: {
                           "Content-Type": "application/json",
                           "Content-Length": Buffer.byteLength(payload),
                           Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                         },
                       },
                       (res) => {
                         let data = "";
                         res.on("data", (chunk) => (data += chunk));
                         res.on("end", () => {
                           if (res.statusCode >= 200 && res.statusCode < 300) {
                             resolve(data ? JSON.parse(data) : {});
                           } else {
                             console.error(`[cbank] WhatsApp send failed (${res.statusCode}):`, data);
                             reject(new Error(`WhatsApp API error ${res.statusCode}: ${data}`));
                           }
                         });
                       }
                       );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// Business-initiated WhatsApp template send. Unlike sendWhatsAppMessage
// (free-form text), this works even outside the 24h customer-service window
// -- required for proactive alerts like the owner's unanswered-query ping,
// since that recipient may never have messaged the business number.
// The template itself must already be approved in WhatsApp Manager.
function sendWhatsAppTemplate(to, templateName, langCode, bodyParams) {
  return new Promise((resolve, reject) => {
    if (!whatsappConfigured()) {
      console.warn(
        "[cbank] WhatsApp not configured (WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN) — template not sent. See .env.example."
      );
      return resolve(null);
    }

    const payload = JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: langCode },
        components: [
          {
            type: "body",
            parameters: bodyParams.map((text) => ({ type: "text", text })),
          },
        ],
      },
    });

    const req = https.request(
      {
        hostname: "graph.facebook.com",
        path: `/${WHATSAPP_API_VERSION}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data ? JSON.parse(data) : {});
          } else {
            console.error(`[cbank] WhatsApp template send failed (${res.statusCode}):`, data);
            reject(new Error(`WhatsApp template API error ${res.statusCode}: ${data}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

function faqText(map, locale) {
  return (map && (map[locale] || map.es || map.en || map.pt)) || "";
}

// WhatsApp text messages can't render the widget's clickable FAQ buttons, so
// replying with a question's number stands in for a click. Reuses the exact
// same `faqs` list agents manage from the dashboard.
const FAQS_INFO_LINK_LINE = "*Toda la Info Aca >> https://faqs.cbank.ws*";

const WHATSAPP_MENU_COPY = {
  es: {
    greeting:
      "¡Hola! Soy el asistente virtual de cbank. Elegí una pregunta escribiendo su número, o escribí tu consulta y un agente te va a responder.",
    menuFooter: `\n\nEscribí *menu* en cualquier momento para volver a ver esta lista.\n\n${FAQS_INFO_LINK_LINE}`,
  },
  en: {
    greeting:
      "Hi! I'm cbank's virtual assistant. Pick a question by typing its number, or type your own question and an agent will reply.",
    menuFooter: `\n\nType *menu* anytime to see this list again.\n\n${FAQS_INFO_LINK_LINE}`,
  },
  pt: {
    greeting:
      "Olá! Sou o assistente virtual do cbank. Escolha uma pergunta digitando o número dela, ou escreva sua dúvida que um agente vai responder.",
    menuFooter: `\n\nDigite *menu* a qualquer momento para ver esta lista novamente.\n\n${FAQS_INFO_LINK_LINE}`,
  },
};

function buildWhatsAppMenuText(locale) {
  const copy = WHATSAPP_MENU_COPY[locale] || WHATSAPP_MENU_COPY.es;
  const lines = faqs.map((f, i) => `${i + 1}. ${faqText(f.question, locale)}`);
  return `${copy.greeting}\n\n${lines.join("\n")}${copy.menuFooter}`;
}

// Same numbered FAQ list as the WhatsApp menu, but without the greeting —
// used to tack the FAQ list onto the 2-minute no-reply escalation message.
function buildFaqListText(locale) {
  if (!faqs.length) return "";
  return faqs.map((f, i) => `${i + 1}. ${faqText(f.question, locale)}`).join("\n");
}

function findWhatsAppSession(from) {
  const existingId = whatsappSessions.get(from);
  return existingId ? sessions.get(existingId) : null;
}

function createWhatsAppSession(from, profileName) {
  const id = uuidv4();
  const session = {
    id,
    name: profileName || `WhatsApp ${from}`,
    email: "",
    whatsapp: from,
    device: "WhatsApp",
    locale: "es",
    channel: "whatsapp",
    location: { ip: "n/a", country: "WhatsApp", city: "WhatsApp" },
    status: "open",
    createdAt: new Date().toISOString(),
    closedAt: null,
    messages: [],
    unread: 0,
    needsReply: false,
    transcriptEmail: null,
  };
  sessions.set(id, session);
  whatsappSessions.set(from, id);
  return session;
}

function pushWhatsAppMessage(session, from, text) {
  const message = { id: uuidv4(), from, text, at: new Date().toISOString() };
  session.messages.push(message);
  io.to(`session-${session.id}`).emit("message:new", message);
  return message;
}

// Handles one inbound WhatsApp text message end to end: resumes or creates
// the session, logs the visitor's message, and either answers instantly via
// the FAQ bot (first-ever message, "menu", or a numbered reply) or leaves it
// unread for a human agent — same split as the web widget's FAQ menu.
async function handleIncomingWhatsAppText(from, text, profileName) {
  let session = findWhatsAppSession(from);
  const isNewSession = !session;
  if (!session) session = createWhatsAppSession(from, profileName);

pushWhatsAppMessage(session, "client", text);

const trimmed = text.trim();
  const isMenuCommand = /^(menu|menú|hi|hola|oi|start)$/i.test(trimmed);
  const asNumber = Number(trimmed);
  const faqIndex = Number.isInteger(asNumber) ? asNumber - 1 : -1;
  const matchedFaq = faqIndex >= 0 && faqIndex < faqs.length ? faqs[faqIndex] : null;

try {
  if (isNewSession || isMenuCommand) {
    const menuText = buildWhatsAppMenuText(session.locale);
    pushWhatsAppMessage(session, "bot", menuText);
    await sendWhatsAppMessage(from, menuText);
  } else if (matchedFaq) {
    const answer = faqText(matchedFaq.answer, session.locale);
    pushWhatsAppMessage(session, "bot", answer);
    await sendWhatsAppMessage(from, answer);
  } else {
    // Free-text question the bot doesn't recognize as a menu pick — leave
  // it unread for a human agent, same as the web widget, and log it so
  // agents can review/promote it into a permanent FAQ later.
  session.unread = (session.unread || 0) + 1;
    session.needsReply = true;
    logUnansweredQuestion(session, trimmed);
    forwardQueryToOwnerWhatsApp(session, trimmed);
    scheduleEscalation(session, trimmed);
  }
} catch (err) {
  console.error("[cbank] Failed to send WhatsApp reply:", err.message);
}

broadcastSessionList();
}

// ---- Instagram Messaging (via the "Instagram API with Instagram Login" —
// a Page-less flow that authenticates directly against the @cbankcard
// Instagram professional account, no linked Facebook Page required) -------
const INSTAGRAM_API_VERSION = process.env.INSTAGRAM_API_VERSION || "v22.0";

function instagramConfigured() {
  return Boolean(process.env.INSTAGRAM_ACCESS_TOKEN);
}

function sendInstagramMessage(igsid, text) {
  return new Promise((resolve, reject) => {
    if (!instagramConfigured()) {
      console.warn(
        "[cbank] Instagram not configured (INSTAGRAM_ACCESS_TOKEN) — message not sent. See .env.example."
      );
      return resolve();
    }
    const payload = JSON.stringify({
      recipient: { id: igsid },
      message: { text },
    });
    const req = https.request(
      {
        hostname: "graph.instagram.com",
        path: `/${INSTAGRAM_API_VERSION}/me/messages?access_token=${encodeURIComponent(
          process.env.INSTAGRAM_ACCESS_TOKEN
        )}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(data ? JSON.parse(data) : {});
          } else {
            console.error(`[cbank] Instagram send failed (${res.statusCode}):`, data);
            reject(new Error(`Instagram API error ${res.statusCode}: ${data}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// Best-effort lookup of the sender's Instagram username, so the dashboard
// shows a real handle instead of a raw IGSID. The messaging webhook itself
// doesn't include a profile, unlike WhatsApp's contact payload.
function fetchInstagramProfile(igsid) {
  return new Promise((resolve) => {
    if (!instagramConfigured()) return resolve(null);
    https
      .get(
        `https://graph.instagram.com/${INSTAGRAM_API_VERSION}/${igsid}?fields=name,username&access_token=${encodeURIComponent(
          process.env.INSTAGRAM_ACCESS_TOKEN
        )}`,
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const parsed = JSON.parse(data);
              resolve(parsed.username || parsed.name || null);
            } catch (e) {
              resolve(null);
            }
          });
        }
      )
      .on("error", () => resolve(null));
  });
}

// Instagram DMs render no text styling at all (asterisks show up literally),
// so this channel gets its own plain-text copy instead of reusing WhatsApp's
// bold markdown.
const FAQS_INFO_LINK_LINE_PLAIN = "Toda la Info Aca >> https://faqs.cbank.ws";

// Marketing-style greeting sent once, the first time a customer DMs
// @cbankcard — the FAQ menu (buildInstagramMenuText) follows right after as
// a second message so they can still pick a numbered question.
const INSTAGRAM_WELCOME_COPY = {
  es:
    "Cbank es una Tarjeta Visa Platinum que se recarga con USDT/USDC, usando Cuentas Bancarias en varios países de Latam, USA y Europa como \"rampa\" de Fiat a Crypto.\n\n" +
    "$0 Emisión de Tarjeta\n0% Comisión por Depósito\n$0 Mantenimiento Mensual\n\n" +
    "Podés crearte Cuentas Bancarias en minutos desde tu celular para enviar y recibir pagos en estos países: USA, UK, Europa, Argentina, Colombia, Brasil y México, en moneda local.\n\n" +
    "Tu Tarjeta VISA USDT es tu billetera.\n\n" +
    "Toda la info: https://linktr.ee/cbank.ws",
  en:
    "Cbank is a Visa Platinum Card you top up with USDT/USDC, using bank accounts in several countries across Latam, the US and Europe as a Fiat-to-Crypto \"ramp\".\n\n" +
    "$0 card issuance\n0% deposit fee\n$0 monthly maintenance\n\n" +
    "You can open bank accounts in minutes from your phone to send and receive payments in these countries: USA, UK, Europe, Argentina, Colombia, Brazil and Mexico, in local currency.\n\n" +
    "Your VISA USDT Card is your wallet.\n\n" +
    "Full info: https://linktr.ee/cbank.ws",
  pt:
    "O Cbank é um Cartão Visa Platinum recarregado com USDT/USDC, usando Contas Bancárias em vários países da América Latina, EUA e Europa como \"rampa\" de Fiat para Cripto.\n\n" +
    "$0 emissão do cartão\n0% taxa de depósito\n$0 manutenção mensal\n\n" +
    "Você pode abrir Contas Bancárias em minutos pelo celular para enviar e receber pagamentos nestes países: EUA, Reino Unido, Europa, Argentina, Colômbia, Brasil e México, em moeda local.\n\n" +
    "Seu Cartão VISA USDT é sua carteira.\n\n" +
    "Toda a info: https://linktr.ee/cbank.ws",
};

function buildInstagramWelcomeText(locale) {
  return INSTAGRAM_WELCOME_COPY[locale] || INSTAGRAM_WELCOME_COPY.es;
}

const INSTAGRAM_MENU_COPY = {
  es: {
    greeting: "Elegí una pregunta escribiendo su número, o escribí tu consulta y un agente te va a responder.",
    menuFooter: `\n\nEscribí menu en cualquier momento para volver a ver esta lista.\n\n${FAQS_INFO_LINK_LINE_PLAIN}`,
  },
  en: {
    greeting: "Pick a question by typing its number, or type your own question and an agent will reply.",
    menuFooter: `\n\nType menu anytime to see this list again.\n\n${FAQS_INFO_LINK_LINE_PLAIN}`,
  },
  pt: {
    greeting: "Escolha uma pergunta digitando o número dela, ou escreva sua dúvida que um agente vai responder.",
    menuFooter: `\n\nDigite menu a qualquer momento para ver esta lista novamente.\n\n${FAQS_INFO_LINK_LINE_PLAIN}`,
  },
};

function buildInstagramMenuText(locale) {
  const copy = INSTAGRAM_MENU_COPY[locale] || INSTAGRAM_MENU_COPY.es;
  const lines = faqs.map((f, i) => `${i + 1}. ${faqText(f.question, locale)}`);
  return `${copy.greeting}\n\n${lines.join("\n")}${copy.menuFooter}`;
}

function findInstagramSession(igsid) {
  const existingId = instagramSessions.get(igsid);
  return existingId ? sessions.get(existingId) : null;
}

function createInstagramSession(igsid, profileName) {
  const id = uuidv4();
  const session = {
    id,
    name: profileName || `Instagram ${igsid}`,
    email: "",
    whatsapp: "",
    instagramId: igsid,
    device: "Instagram",
    locale: "es",
    channel: "instagram",
    location: { ip: "n/a", country: "Instagram", city: "Instagram" },
    status: "open",
    createdAt: new Date().toISOString(),
    closedAt: null,
    messages: [],
    unread: 0,
    needsReply: false,
    transcriptEmail: null,
  };
  sessions.set(id, session);
  instagramSessions.set(igsid, id);
  return session;
}

function pushInstagramMessage(session, from, text) {
  const message = { id: uuidv4(), from, text, at: new Date().toISOString() };
  session.messages.push(message);
  io.to(`session-${session.id}`).emit("message:new", message);
  return message;
}

// Handles one inbound Instagram DM end to end — same split as WhatsApp: the
// very first message from a new contact gets the marketing welcome text plus
// the FAQ menu, "menu"/a numbered reply gets an instant bot answer, and
// anything else is left unread for a human agent (with an immediate owner
// WhatsApp alert + the 2-minute escalation, exactly like every other channel).
async function handleIncomingInstagramText(igsid, text, profileName) {
  let session = findInstagramSession(igsid);
  const isNewSession = !session;
  if (!session) {
    if (!profileName) profileName = await fetchInstagramProfile(igsid);
    session = createInstagramSession(igsid, profileName);
  }

  pushInstagramMessage(session, "client", text);

  const trimmed = text.trim();
  const isMenuCommand = /^(menu|menú|hi|hola|oi|start)$/i.test(trimmed);
  const asNumber = Number(trimmed);
  const faqIndex = Number.isInteger(asNumber) ? asNumber - 1 : -1;
  const matchedFaq = faqIndex >= 0 && faqIndex < faqs.length ? faqs[faqIndex] : null;

  try {
    if (isNewSession) {
      const welcomeText = buildInstagramWelcomeText(session.locale);
      pushInstagramMessage(session, "bot", welcomeText);
      await sendInstagramMessage(igsid, welcomeText);

      const menuText = buildInstagramMenuText(session.locale);
      pushInstagramMessage(session, "bot", menuText);
      await sendInstagramMessage(igsid, menuText);
    } else if (isMenuCommand) {
      const menuText = buildInstagramMenuText(session.locale);
      pushInstagramMessage(session, "bot", menuText);
      await sendInstagramMessage(igsid, menuText);
    } else if (matchedFaq) {
      const answer = faqText(matchedFaq.answer, session.locale);
      pushInstagramMessage(session, "bot", answer);
      await sendInstagramMessage(igsid, answer);
    } else {
      session.unread = (session.unread || 0) + 1;
      session.needsReply = true;
      logUnansweredQuestion(session, trimmed);
      forwardQueryToOwnerWhatsApp(session, trimmed);
      scheduleEscalation(session, trimmed);
    }
  } catch (err) {
    console.error("[cbank] Failed to send Instagram reply:", err.message);
  }

  broadcastSessionList();
}

// ---- WhatsApp webhook endpoints -----------------------------------------
// GET: Meta's one-time verification handshake when you register the webhook
// URL in the app dashboard (Meta for Developers → WhatsApp → Configuration).
app.get("/webhooks/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

        if (mode === "subscribe" && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
          return res.status(200).send(challenge);
        }
  return res.sendStatus(403);
});

// POST: incoming messages and status updates. Meta expects a fast 200 OK, so
// we ack immediately and process after.
app.post("/webhooks/whatsapp", (req, res) => {
  res.sendStatus(200);

         try {
           const entry = req.body.entry && req.body.entry[0];
           const change = entry && entry.changes && entry.changes[0];
           const value = change && change.value;
           const messages = value && value.messages;
           if (!messages || !messages.length) {
             // Delivery/read status updates land here — log failures so we can
             // see *why* an outbound message (like the owner alert) didn't land.
             const statuses = value && value.statuses;
             if (statuses && statuses.length) {
               statuses.forEach((s) => {
                 if (s.status === "failed" && s.errors) {
                   console.error("[cbank] WhatsApp delivery FAILED:", JSON.stringify(s.errors));
                 } else {
                   console.log(`[cbank] WhatsApp status update: ${s.status} for ${s.recipient_id}`);
                 }
               });
             }
             return;
           }

  const contact = value.contacts && value.contacts[0];
           const profileName = contact && contact.profile && contact.profile.name;

  messages.forEach((msg) => {
    if (msg.type !== "text") return; // interactive/media messages: out of scope for this build
                   handleIncomingWhatsAppText(msg.from, msg.text.body, profileName);
  });
         } catch (err) {
           console.error("[cbank] Error handling WhatsApp webhook payload:", err);
         }
});

// ---- Instagram webhook endpoints ----------------------------------------
// GET: Meta's one-time verification handshake when you register the webhook
// URL for the Page (Meta for Developers → your App → Webhooks → Instagram).
app.get("/webhooks/instagram", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token && token === process.env.INSTAGRAM_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// POST: incoming Instagram DMs. Meta expects a fast 200 OK, so we ack
// immediately and process after — same pattern as the WhatsApp webhook.
app.post("/webhooks/instagram", (req, res) => {
  res.sendStatus(200);
  console.log("[cbank] Instagram webhook payload:", JSON.stringify(req.body));

  try {
    const entries = req.body.entry || [];
    entries.forEach((entry) => {
      const messagingEvents = entry.messaging || [];
      messagingEvents.forEach((event) => {
        // Ignore echoes of our own outbound messages and anything without text
        // (attachments, reactions, read receipts, etc. — out of scope here).
        if (!event.message || event.message.is_echo || !event.message.text) return;
        const igsid = event.sender && event.sender.id;
        if (!igsid) return;
        handleIncomingInstagramText(igsid, event.message.text);
      });
    });
  } catch (err) {
    console.error("[cbank] Error handling Instagram webhook payload:", err);
  }
});

io.on("connection", (socket) => {
  // FAQ list is global config, not per-session — send it to whoever just
      // connected (widget or dashboard) right away.
      socket.emit("faqs:list", faqs);

      // ---- Client (widget) events -----------------------------------------
      socket.on("client:join", ({ sessionId, name, email, whatsapp, device, locale }) => {
        let id = sessionId && sessions.has(sessionId) ? sessionId : uuidv4();
        const ip = getClientIp(socket);

                if (!sessions.has(id)) {
                  sessions.set(id, {
                    id,
                    name: name || "cbank client",
                    email: email || "",
                    whatsapp: whatsapp || "",
                    device: device || "Unknown device",
                    locale: EMAIL_TEMPLATES[locale] ? locale : "es",
                    channel: "web",
                    location: { ip, country: "Detecting…", city: "Detecting…" },
                    status: "open",
                    createdAt: new Date().toISOString(),
                    closedAt: null,
                    messages: [],
                    unread: 0,
                    needsReply: false,
                    transcriptEmail: null,
                  });
                } else {
                  // Returning visitor on the same session — keep contact details current.
        const existing = sessions.get(id);
                  if (name) existing.name = name;
                  if (email) existing.email = email;
                  if (whatsapp) existing.whatsapp = whatsapp;
                  if (device) existing.device = device;
                  if (EMAIL_TEMPLATES[locale]) existing.locale = locale;
                  if (!existing.location) existing.location = { ip, country: "Detecting…", city: "Detecting…" };
                }

                socket.data.sessionId = id;
        socket.data.role = "client";
        socket.join(`session-${id}`);

                socket.emit("client:joined", {
                  sessionId: id,
                  messages: sessions.get(id).messages,
                });

                broadcastSessionList();

                // Resolve geolocation asynchronously so the join isn't delayed by a
                // slow (or rate-limited) third-party API call.
                geolocateIp(ip).then((location) => {
                  const s = sessions.get(id);
                  if (!s) return;
                  s.location = location;
                  broadcastSessionList();
                });
      });

      socket.on("client:message", ({ sessionId, text }) => {
        const session = sessions.get(sessionId);
        if (!session || !text || !text.trim()) return;

                const message = {
                  id: uuidv4(),
                  from: "client",
                  text: text.trim(),
                  at: new Date().toISOString(),
                };
        session.messages.push(message);
        session.unread = (session.unread || 0) + 1;
        session.needsReply = true;
        logUnansweredQuestion(session, message.text);
        forwardQueryToOwnerWhatsApp(session, message.text);
        scheduleEscalation(session, message.text);

                io.to(`session-${sessionId}`).emit("message:new", message);
        broadcastSessionList();
      });

      socket.on("client:typing", ({ sessionId, isTyping }) => {
        socket.to(`session-${sessionId}`).emit("typing", { from: "client", isTyping });
      });

      // Visitor clicked a FAQ bot button: log the question as if the visitor
      // asked it, then answer instantly as "bot" — no agent required. Both
      // messages land in session history (and the emailed transcript), so an
      // agent who joins later still has full context.
      socket.on("client:faq", ({ sessionId, faqId, locale }) => {
        const session = sessions.get(sessionId);
        const faq = faqs.find((f) => f.id === faqId);
        if (!session || !faq) return;

                const loc = EMAIL_TEMPLATES[locale] ? locale : session.locale || "es";
        const pick = (map) => (map && (map[loc] || map.es || map.en || map.pt)) || "";

                const questionMsg = { id: uuidv4(), from: "client", text: pick(faq.question), at: new Date().toISOString() };
        const answerMsg = { id: uuidv4(), from: "bot", text: pick(faq.answer), at: new Date().toISOString() };
        session.messages.push(questionMsg, answerMsg);
        // Not counted as "unread" — the bot already handled it, no need to page an agent.

                io.to(`session-${sessionId}`).emit("message:new", questionMsg);
        io.to(`session-${sessionId}`).emit("message:new", answerMsg);
        broadcastSessionList();
      });

      // ---- Agent (dashboard) events ----------------------------------------
      socket.on("agent:join", () => {
        socket.data.role = "agent";
        socket.join("agents");
        broadcastSessionList();
        socket.emit("unanswered:list", unansweredQuestions);
      });

      socket.on("agent:watch", (sessionId) => {
        socket.join(`session-${sessionId}`);
        const session = sessions.get(sessionId);
        if (session) {
          session.unread = 0;
          socket.emit("agent:history", { sessionId, messages: session.messages });
          broadcastSessionList();
        }
      });

      socket.on("agent:message", ({ sessionId, text }) => {
        const session = sessions.get(sessionId);
        if (!session || !text || !text.trim()) return;

                const message = {
                  id: uuidv4(),
                  from: "agent",
                  text: text.trim(),
                  at: new Date().toISOString(),
                };
        session.messages.push(message);
        session.needsReply = false;
        clearEscalationTimer(sessionId);

                io.to(`session-${sessionId}`).emit("message:new", message);
        broadcastSessionList();

                if (session.channel === "whatsapp") {
                  sendWhatsAppMessage(session.whatsapp, message.text).catch((err) => {
                    console.error("[cbank] Failed to deliver agent reply over WhatsApp:", err.message);
                  });
                } else if (session.channel === "instagram") {
                  sendInstagramMessage(session.instagramId, message.text).catch((err) => {
                    console.error("[cbank] Failed to deliver agent reply over Instagram:", err.message);
                  });
                }
      });

      socket.on("agent:typing", ({ sessionId, isTyping }) => {
        socket.to(`session-${sessionId}`).emit("typing", { from: "agent", isTyping });
      });

      // FAQ bot management — create (no id) or update (id) a question/answer
      // pair. Each field is a { es, en, pt } map; at least one language must be
      // filled in for question and for answer, so a bare-minimum FAQ still
      // resolves to *something* via the es -> en -> pt fallback used everywhere
      // else in this app.
      socket.on("agent:faqs:save", ({ id, question, answer } = {}) => {
        const q = {
          es: ((question && question.es) || "").trim(),
          en: ((question && question.en) || "").trim(),
          pt: ((question && question.pt) || "").trim(),
        };
        const a = {
          es: ((answer && answer.es) || "").trim(),
          en: ((answer && answer.en) || "").trim(),
          pt: ((answer && answer.pt) || "").trim(),
        };
        if (!(q.es || q.en || q.pt) || !(a.es || a.en || a.pt)) return;

  if (id) {
    const existing = faqs.find((f) => f.id === id);
    if (existing) {
      existing.question = q;
      existing.answer = a;
    }
  } else {
    faqs.push({ id: uuidv4(), question: q, answer: a });
  }
        io.emit("faqs:list", faqs);
      });

socket.on("agent:faqs:delete", (id) => {
  faqs = faqs.filter((f) => f.id !== id);
  io.emit("faqs:list", faqs);
});

socket.on("agent:close", (sessionId) => {
  const session = sessions.get(sessionId);
  if (!session) return;

          session.status = "closed";
  session.closedAt = new Date().toISOString();
  session.needsReply = false;
  clearEscalationTimer(sessionId);
  session.transcriptEmail = { status: "sending" };

          io.to(`session-${sessionId}`).emit("session:closed");
  broadcastSessionList();

          // Fire-and-forget: updates session.transcriptEmail and rebroadcasts once done.
          sendTranscriptEmail(session);
});

socket.on("agent:reopen", (sessionId) => {
  const session = sessions.get(sessionId);
  if (!session) return;

          session.status = "open";
  session.closedAt = null;

          io.to(`session-${sessionId}`).emit("session:reopened");
  broadcastSessionList();
});

socket.on("agent:unanswered:dismiss", (id) => {
  unansweredQuestions = unansweredQuestions.filter((q) => q.id !== id);
  io.to("agents").emit("unanswered:list", unansweredQuestions);
});

socket.on("disconnect", () => {
  // Sessions persist in memory so a client reconnecting (e.g. page refresh)
          // with the same sessionId can resume the conversation.
});
});

server.listen(PORT, () => {
  console.log(`cbank live chat server running at http://localhost:${PORT}`);
  console.log(`  Widget demo: http://localhost:${PORT}/widget-demo.html`);
  console.log(`  Agent dashboard: http://localhost:${PORT}/agent-dashboard.html`);
  console.log(`  WhatsApp webhook: http://localhost:${PORT}/webhooks/whatsapp`);
  console.log(`  Instagram webhook: http://localhost:${PORT}/webhooks/instagram`);
  getMailer(); // logs a warning immediately if SMTP isn't configured, instead of only on first close
              if (!whatsappConfigured()) {
                console.warn(
                  "[cbank] WhatsApp not configured (WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN) — incoming messages will be logged but replies won't be sent. See .env.example."
                  );
              }
              if (!instagramConfigured()) {
                console.warn(
                  "[cbank] Instagram not configured (INSTAGRAM_ACCESS_TOKEN) — incoming DMs will be logged but replies won't be sent. See .env.example."
                  );
              }
});
