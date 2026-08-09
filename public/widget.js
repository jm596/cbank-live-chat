/**
 * cbank Live Chat — embeddable client widget
 *
 * Drop this on any page:
 *   <script src="https://chat.cbank.example/widget.js"
 *           data-server="https://chat.cbank.example"></script>
 *
 * If data-server is omitted, the widget assumes it's served from the same
 * origin as the chat server (fine for the local demo).
 *
 * Before the chat opens, visitors fill a short pre-chat form (name, email,
 * country code + WhatsApp number). All UI text is localized (English/
 * Spanish/Portuguese, auto-detected from the browser, switchable via a
 * visible button) — see I18N below. Country, city, device, and IP are
 * detected automatically (country/city/IP server-side, device client-side)
 * and shown to agents — the visitor doesn't need to enter any of that.
 *
 * A welcome bot greets the visitor and offers a menu of frequently asked
 * questions (managed by agents from the dashboard). Clicking a question
 * gets an instant bot answer — no need to wait for a human agent — while
 * still logging both into the conversation so an agent can pick up context
 * if the visitor keeps chatting.
 */
(function () {
  var scriptTag = document.currentScript;
  var SERVER_URL = (scriptTag && scriptTag.getAttribute("data-server")) || window.location.origin;
  var SESSION_KEY = "cbank_chat_session_id";
  var PROFILE_KEY = "cbank_chat_profile"; // { name, email, whatsapp }
  var LOCALE_KEY = "cbank_chat_locale";
  var LOCALES = ["es", "en", "pt"];

  // ---- i18n --------------------------------------------------------
  var I18N = {
    en: {
      headerTitle: "cbank Support",
      headerSubtitle: "We usually reply in a few minutes",
      prechatTitle: "Before we start…",
      prechatSubtitle: "A few quick details so we can help you faster.",
      nameLabel: "What's your name?",
      namePlaceholder: "Full name",
      emailLabel: "Enter your email",
      emailPlaceholder: "you@example.com",
      whatsappLabel: "WhatsApp number",
      whatsappNumberPlaceholder: "Number",
      startButton: "Start chat",
      inputPlaceholder: "Type your message…",
      sendButton: "Send",
      typingIndicator: "Agent is typing…",
      welcomeMessage: "Hi {name}! Welcome to cbank support. I'm the cbank bot — pick a question below, or type your own message any time and an agent will jump in.",
      closedMessage: "This conversation has been closed by a support agent. We've emailed you a copy.",
      requiredError: "Please fill in all three fields.",
      emailError: "Please enter a valid email address.",
      whatsappError: "Please enter a valid WhatsApp number.",
      langButton: "ES",
      faqToggleLabel: "Frequently asked questions",
      faqMenuTitle: "How can we help?",
      botLabel: "cbank Bot",
    },
    es: {
      headerTitle: "Soporte cbank",
      headerSubtitle: "Normalmente respondemos en pocos minutos",
      prechatTitle: "Antes de comenzar…",
      prechatSubtitle: "Unos datos rápidos para atenderle mejor.",
      nameLabel: "Díganos su nombre por favor",
      namePlaceholder: "Nombre completo",
      emailLabel: "Escriba su mail",
      emailPlaceholder: "usted@ejemplo.com",
      whatsappLabel: "Número de WhatsApp",
      whatsappNumberPlaceholder: "Número",
      startButton: "Iniciar chat",
      inputPlaceholder: "Escriba su mensaje…",
      sendButton: "Enviar",
      typingIndicator: "El agente está escribiendo…",
      welcomeMessage: "¡Hola {name}! Bienvenido al soporte de cbank. Soy el bot de cbank — elija una pregunta abajo, o escriba su mensaje cuando quiera y un agente se sumará.",
      closedMessage: "Esta conversación ha sido cerrada por un agente de soporte. Le enviamos una copia por correo.",
      requiredError: "Por favor complete los tres campos.",
      emailError: "Por favor ingrese un correo válido.",
      whatsappError: "Por favor ingrese un número de WhatsApp válido.",
      langButton: "PT",
      faqToggleLabel: "Preguntas frecuentes",
      faqMenuTitle: "¿En qué podemos ayudarle?",
      botLabel: "Bot de cbank",
    },
    pt: {
      headerTitle: "Suporte cbank",
      headerSubtitle: "Normalmente respondemos em poucos minutos",
      prechatTitle: "Antes de começar…",
      prechatSubtitle: "Alguns dados rápidos para atendê-lo melhor.",
      nameLabel: "Qual é o seu nome?",
      namePlaceholder: "Nome completo",
      emailLabel: "Digite seu e-mail",
      emailPlaceholder: "voce@exemplo.com",
      whatsappLabel: "Número do WhatsApp",
      whatsappNumberPlaceholder: "Número",
      startButton: "Iniciar chat",
      inputPlaceholder: "Digite sua mensagem…",
      sendButton: "Enviar",
      typingIndicator: "O agente está digitando…",
      welcomeMessage: "Olá {name}! Bem-vindo ao suporte cbank. Sou o bot da cbank — escolha uma pergunta abaixo, ou digite sua mensagem quando quiser e um agente vai entrar.",
      closedMessage: "Esta conversa foi encerrada por um agente de suporte. Enviamos uma cópia para o seu e-mail.",
      requiredError: "Por favor, preencha os três campos.",
      emailError: "Por favor, insira um e-mail válido.",
      whatsappError: "Por favor, insira um número de WhatsApp válido.",
      langButton: "EN",
      faqToggleLabel: "Perguntas frequentes",
      faqMenuTitle: "Como podemos ajudar?",
      botLabel: "Bot da cbank",
    },
  };

  // Common Latin America + North America/Iberia dial codes. Add more as needed.
  var COUNTRY_CODES = [
    { code: "+1", flag: "🇺🇸", name: "Estados Unidos / Canadá" },
    { code: "+52", flag: "🇲🇽", name: "México" },
    { code: "+502", flag: "🇬🇹", name: "Guatemala" },
    { code: "+503", flag: "🇸🇻", name: "El Salvador" },
    { code: "+504", flag: "🇭🇳", name: "Honduras" },
    { code: "+505", flag: "🇳🇮", name: "Nicaragua" },
    { code: "+506", flag: "🇨🇷", name: "Costa Rica" },
    { code: "+507", flag: "🇵🇦", name: "Panamá" },
    { code: "+1809", flag: "🇩🇴", name: "República Dominicana" },
    { code: "+57", flag: "🇨🇴", name: "Colombia" },
    { code: "+58", flag: "🇻🇪", name: "Venezuela" },
    { code: "+593", flag: "🇪🇨", name: "Ecuador" },
    { code: "+51", flag: "🇵🇪", name: "Perú" },
    { code: "+591", flag: "🇧🇴", name: "Bolivia" },
    { code: "+56", flag: "🇨🇱", name: "Chile" },
    { code: "+54", flag: "🇦🇷", name: "Argentina" },
    { code: "+598", flag: "🇺🇾", name: "Uruguay" },
    { code: "+595", flag: "🇵🇾", name: "Paraguay" },
    { code: "+55", flag: "🇧🇷", name: "Brasil" },
    { code: "+34", flag: "🇪🇸", name: "España" },
    { code: "+351", flag: "🇵🇹", name: "Portugal" },
  ];

  var DEFAULT_COUNTRY_BY_LOCALE = { es: "+52", en: "+1", pt: "+55" };

  function detectLocale() {
    var stored = localStorage.getItem(LOCALE_KEY);
    if (stored && I18N[stored]) return stored;
    var nav = (navigator.language || navigator.userLanguage || "en").toLowerCase();
    if (nav.indexOf("es") === 0) return "es";
    if (nav.indexOf("pt") === 0) return "pt";
    return "en";
  }

  // ---- Device detection (client-side; sent once at join, shown to agents) --
  function detectDevice() {
    var ua = navigator.userAgent || "";
    var os = "Unknown OS";
    if (/Windows/i.test(ua)) os = "Windows";
    else if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
    else if (/Android/i.test(ua)) os = "Android";
    else if (/Mac OS X/i.test(ua)) os = "macOS";
    else if (/Linux/i.test(ua)) os = "Linux";

    var browser = "Unknown browser";
    if (/Edg\//i.test(ua)) browser = "Edge";
    else if (/OPR\//i.test(ua)) browser = "Opera";
    else if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) browser = "Chrome";
    else if (/Firefox\//i.test(ua)) browser = "Firefox";
    else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = "Safari";

    var type = /Mobi|Android|iPhone|iPad/i.test(ua) ? "Mobile" : "Desktop";

    return browser + " on " + os + " (" + type + ")";
  }

  // Picks the FAQ's text in the current locale, falling back through
  // es -> en -> pt so a partially-translated FAQ still shows something.
  function faqText(map) {
    if (!map) return "";
    return map[state.locale] || map.es || map.en || map.pt || "";
  }

  var state = {
    locale: detectLocale(),
    profile: safeParse(localStorage.getItem(PROFILE_KEY)),
    faqs: [],
  };

  function t(key, vars) {
    var str = (I18N[state.locale] && I18N[state.locale][key]) || I18N.en[key] || key;
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        str = str.replace("{" + k + "}", vars[k]);
      });
    }
    return str;
  }

  function safeParse(json) {
    try {
      return json ? JSON.parse(json) : null;
    } catch (e) {
      return null;
    }
  }

  // ---- Load socket.io client from the chat server, then boot -----------
  var sioScript = document.createElement("script");
  sioScript.src = SERVER_URL + "/socket.io/socket.io.js";
  sioScript.onload = boot;
  document.head.appendChild(sioScript);

  function boot() {
    injectStyles();
    var ui = buildUI();
    document.body.appendChild(ui.root);
    populateCountrySelect(ui);
    applyLocaleTexts(ui);

    var socket = null;
    var sessionId = localStorage.getItem(SESSION_KEY) || null;
    var joined = false;
    var unreadCount = 0;
    var showedWelcomeMenu = false;

    // ---- Language toggle (visible at all times: pre-chat + chat) -----
    ui.langBtn.addEventListener("click", function () {
      var idx = LOCALES.indexOf(state.locale);
      state.locale = LOCALES[(idx + 1) % LOCALES.length];
      localStorage.setItem(LOCALE_KEY, state.locale);
      applyLocaleTexts(ui);
      renderFaqMenu(ui);
    });

    // ---- Pre-chat form ------------------------------------------------
    function showPrechat() {
      ui.prechat.style.display = "flex";
      ui.chatBody.style.display = "none";
    }

    function showChat() {
      ui.prechat.style.display = "none";
      ui.chatBody.style.display = "flex";
    }

    ui.prechatForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = ui.nameInput.value.trim();
      var email = ui.emailInput.value.trim();
      var countryCode = ui.whatsappCountry.value;
      var number = ui.whatsappNumber.value.trim();

      ui.prechatError.textContent = "";

      if (!name || !email || !number) {
        ui.prechatError.textContent = t("requiredError");
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        ui.prechatError.textContent = t("emailError");
        return;
      }
      var digits = number.replace(/[^0-9]/g, "");
      if (digits.length < 6) {
        ui.prechatError.textContent = t("whatsappError");
        return;
      }

      state.profile = { name: name, email: email, whatsapp: countryCode + " " + digits };
      localStorage.setItem(PROFILE_KEY, JSON.stringify(state.profile));
      showChat();
      connectAndJoin();
    });

    function connectAndJoin() {
      if (socket) return; // already connected
      socket = io(SERVER_URL, { transports: ["websocket", "polling"] });

      socket.on("connect", function () {
        socket.emit("client:join", {
          sessionId: sessionId,
          name: state.profile.name,
          email: state.profile.email,
          whatsapp: state.profile.whatsapp,
          device: detectDevice(),
          locale: state.locale,
        });
      });

      socket.on("faqs:list", function (faqs) {
        state.faqs = faqs || [];
        renderFaqMenu(ui);
        maybeShowWelcomeMenu();
      });

      socket.on("client:joined", function (data) {
        sessionId = data.sessionId;
        localStorage.setItem(SESSION_KEY, sessionId);
        joined = true;
        ui.messagesEl.innerHTML = "";
        if (data.messages.length === 0) {
          appendMessage(ui, "agent", t("welcomeMessage", { name: state.profile.name }));
          maybeShowWelcomeMenu();
        } else {
          data.messages.forEach(function (m) {
            appendMessage(ui, m.from, m.text);
          });
        }
      });

      socket.on("message:new", function (message) {
        appendMessage(ui, message.from, message.text);
        if ((message.from === "agent" || message.from === "bot") && !ui.root.classList.contains("cbank-open")) {
          unreadCount++;
          updateBadge(ui, unreadCount);
        }
      });

      socket.on("typing", function (data) {
        if (data.from === "agent") {
          ui.typingEl.style.display = data.isTyping ? "block" : "none";
        }
      });

      socket.on("session:closed", function () {
        appendMessage(ui, "system", t("closedMessage"));
        ui.faqPanel.style.display = "none";
      });
    }

    function maybeShowWelcomeMenu() {
      if (showedWelcomeMenu || !joined) return;
      if (state.faqs.length === 0) return;
      showedWelcomeMenu = true;
      ui.faqPanel.style.display = "flex";
    }

    // ---- FAQ menu -------------------------------------------------------
    ui.faqToggleBtn.addEventListener("click", function () {
      var isVisible = ui.faqPanel.style.display === "flex";
      ui.faqPanel.style.display = isVisible ? "none" : "flex";
    });

    ui.faqPanel.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-faq-id]");
      if (!btn || !socket || !joined) return;
      socket.emit("client:faq", { sessionId: sessionId, faqId: btn.getAttribute("data-faq-id"), locale: state.locale });
      ui.faqPanel.style.display = "none";
    });

    function renderFaqMenu(ui) {
      ui.faqToggleBtn.style.display = state.faqs.length > 0 ? "block" : "none";
      ui.faqMenuTitleEl.textContent = t("faqMenuTitle");
      ui.faqToggleBtn.textContent = "❓ " + t("faqToggleLabel");
      ui.faqListEl.innerHTML = "";
      state.faqs.forEach(function (faq) {
        var item = document.createElement("button");
        item.type = "button";
        item.className = "cbank-faq-item";
        item.setAttribute("data-faq-id", faq.id);
        item.textContent = faqText(faq.question);
        ui.faqListEl.appendChild(item);
      });
    }

    // ---- Bubble open/close --------------------------------------------
    ui.bubble.addEventListener("click", function () {
      var isOpen = ui.root.classList.toggle("cbank-open");
      if (!isOpen) return;

      unreadCount = 0;
      updateBadge(ui, 0);

      if (state.profile && state.profile.name) {
        showChat();
        connectAndJoin();
        ui.input.focus();
      } else {
        showPrechat();
        ui.nameInput.focus();
      }
    });

    ui.closeBtn.addEventListener("click", function () {
      ui.root.classList.remove("cbank-open");
    });

    function send() {
      var text = ui.input.value;
      if (!text.trim() || !joined) return;
      socket.emit("client:message", { sessionId: sessionId, text: text });
      ui.input.value = "";
      socket.emit("client:typing", { sessionId: sessionId, isTyping: false });
    }

    ui.sendBtn.addEventListener("click", send);
    ui.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        send();
      } else if (socket) {
        socket.emit("client:typing", { sessionId: sessionId, isTyping: true });
      }
    });

    // Start in the right view; connect immediately if we already know the
    // visitor (returning session), otherwise wait for the bubble click.
    if (state.profile && state.profile.name) {
      showChat();
    } else {
      showPrechat();
    }
  }

  function populateCountrySelect(ui) {
    COUNTRY_CODES.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c.code;
      opt.textContent = c.flag + " " + c.code + " " + c.name;
      ui.whatsappCountry.appendChild(opt);
    });
    var preferred = DEFAULT_COUNTRY_BY_LOCALE[state.locale] || "+1";
    if (COUNTRY_CODES.some(function (c) { return c.code === preferred; })) {
      ui.whatsappCountry.value = preferred;
    }
  }

  function applyLocaleTexts(ui) {
    ui.langBtn.textContent = t("langButton");
    ui.headerTitle.textContent = t("headerTitle");
    ui.headerSubtitle.textContent = t("headerSubtitle");
    ui.prechatTitleEl.textContent = t("prechatTitle");
    ui.prechatSubtitleEl.textContent = t("prechatSubtitle");
    ui.nameLabelEl.textContent = t("nameLabel");
    ui.nameInput.placeholder = t("namePlaceholder");
    ui.emailLabelEl.textContent = t("emailLabel");
    ui.emailInput.placeholder = t("emailPlaceholder");
    ui.whatsappLabelEl.textContent = t("whatsappLabel");
    ui.whatsappNumber.placeholder = t("whatsappNumberPlaceholder");
    ui.startBtn.textContent = t("startButton");
    ui.input.placeholder = t("inputPlaceholder");
    ui.sendBtn.textContent = t("sendButton");
    ui.typingEl.textContent = t("typingIndicator");
    ui.faqMenuTitleEl.textContent = t("faqMenuTitle");
    ui.faqToggleBtn.textContent = "❓ " + t("faqToggleLabel");
    if (state.profile && state.profile.name) {
      // Pre-fill in case the visitor reopens the form via browser back/forward.
      if (!ui.nameInput.value) ui.nameInput.value = state.profile.name;
      if (!ui.emailInput.value) ui.emailInput.value = state.profile.email;
    }
  }

  function appendMessage(ui, from, text) {
    var row = document.createElement("div");
    row.className = "cbank-msg cbank-msg-" + from;
    if (from === "bot") {
      var label = document.createElement("div");
      label.className = "cbank-bot-label";
      label.textContent = t("botLabel");
      row.appendChild(label);
    }
    var bubble = document.createElement("div");
    bubble.className = "cbank-bubble-text";
    bubble.textContent = text;
    row.appendChild(bubble);
    ui.messagesEl.appendChild(row);
    ui.messagesEl.scrollTop = ui.messagesEl.scrollHeight;
  }

  function updateBadge(ui, count) {
    if (count > 0) {
      ui.badge.textContent = count > 9 ? "9+" : String(count);
      ui.badge.style.display = "flex";
    } else {
      ui.badge.style.display = "none";
    }
  }

  function buildUI() {
    var root = document.createElement("div");
    root.id = "cbank-chat-root";

    root.innerHTML =
      '<button id="cbank-chat-bubble" aria-label="Open cbank support chat">' +
      '  <span class="cbank-bubble-icon">\u{1F4AC}</span>' +
      '  <span id="cbank-chat-badge"></span>' +
      "</button>" +
      '<div id="cbank-chat-window" role="dialog" aria-label="cbank support chat">' +
      '  <div id="cbank-chat-header">' +
      '    <div>' +
      '      <div class="cbank-header-title" id="cbank-header-title"></div>' +
      '      <div class="cbank-header-subtitle" id="cbank-header-subtitle"></div>' +
      "    </div>" +
      '    <button id="cbank-lang-btn" type="button" aria-label="Switch language"></button>' +
      '    <button id="cbank-chat-close" aria-label="Close chat">×</button>' +
      "  </div>" +

      '  <form id="cbank-prechat">' +
      '    <div id="cbank-prechat-title"></div>' +
      '    <div id="cbank-prechat-subtitle"></div>' +
      '    <label class="cbank-field-label" id="cbank-name-label"></label>' +
      '    <input id="cbank-name-input" type="text" required />' +
      '    <label class="cbank-field-label" id="cbank-email-label"></label>' +
      '    <input id="cbank-email-input" type="email" required />' +
      '    <label class="cbank-field-label" id="cbank-whatsapp-label"></label>' +
      '    <div id="cbank-whatsapp-row">' +
      '      <select id="cbank-whatsapp-country"></select>' +
      '      <input id="cbank-whatsapp-number" type="tel" required />' +
      "    </div>" +
      '    <div id="cbank-prechat-error"></div>' +
      '    <button id="cbank-start-btn" type="submit"></button>' +
      "  </form>" +

      '  <div id="cbank-chat-body">' +
      '    <div id="cbank-chat-messages"></div>' +
      '    <div id="cbank-chat-typing"></div>' +
      '    <div id="cbank-faq-panel">' +
      '      <div id="cbank-faq-title"></div>' +
      '      <div id="cbank-faq-list"></div>' +
      "    </div>" +
      '    <button id="cbank-faq-toggle" type="button"></button>' +
      '    <div id="cbank-chat-inputbar">' +
      '      <input id="cbank-chat-input" type="text" autocomplete="off" />' +
      '      <button id="cbank-chat-send"></button>' +
      "    </div>" +
      "  </div>" +
      "</div>";

    return {
      root: root,
      bubble: root.querySelector("#cbank-chat-bubble"),
      badge: root.querySelector("#cbank-chat-badge"),
      closeBtn: root.querySelector("#cbank-chat-close"),
      langBtn: root.querySelector("#cbank-lang-btn"),
      headerTitle: root.querySelector("#cbank-header-title"),
      headerSubtitle: root.querySelector("#cbank-header-subtitle"),

      prechat: root.querySelector("#cbank-prechat"),
      prechatForm: root.querySelector("#cbank-prechat"),
      prechatTitleEl: root.querySelector("#cbank-prechat-title"),
      prechatSubtitleEl: root.querySelector("#cbank-prechat-subtitle"),
      prechatError: root.querySelector("#cbank-prechat-error"),
      nameLabelEl: root.querySelector("#cbank-name-label"),
      nameInput: root.querySelector("#cbank-name-input"),
      emailLabelEl: root.querySelector("#cbank-email-label"),
      emailInput: root.querySelector("#cbank-email-input"),
      whatsappLabelEl: root.querySelector("#cbank-whatsapp-label"),
      whatsappCountry: root.querySelector("#cbank-whatsapp-country"),
      whatsappNumber: root.querySelector("#cbank-whatsapp-number"),
      startBtn: root.querySelector("#cbank-start-btn"),

      chatBody: root.querySelector("#cbank-chat-body"),
      messagesEl: root.querySelector("#cbank-chat-messages"),
      typingEl: root.querySelector("#cbank-chat-typing"),
      faqToggleBtn: root.querySelector("#cbank-faq-toggle"),
      faqPanel: root.querySelector("#cbank-faq-panel"),
      faqMenuTitleEl: root.querySelector("#cbank-faq-title"),
      faqListEl: root.querySelector("#cbank-faq-list"),
      input: root.querySelector("#cbank-chat-input"),
      sendBtn: root.querySelector("#cbank-chat-send"),
    };
  }

  function injectStyles() {
    var css =
      "#cbank-chat-root{position:fixed;bottom:24px;right:24px;z-index:999999;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;}" +
      "#cbank-chat-bubble{width:60px;height:60px;border-radius:50%;background:#0b3d91;border:none;box-shadow:0 4px 14px rgba(11,61,145,0.35);cursor:pointer;display:flex;align-items:center;justify-content:center;position:relative;transition:transform .15s ease;}" +
      "#cbank-chat-bubble:hover{transform:scale(1.06);}" +
      ".cbank-bubble-icon{font-size:26px;line-height:1;}" +
      "#cbank-chat-badge{display:none;position:absolute;top:-4px;right:-4px;background:#e0263a;color:#fff;font-size:11px;font-weight:600;min-width:18px;height:18px;border-radius:9px;align-items:center;justify-content:center;padding:0 4px;}" +
      "#cbank-chat-window{display:none;flex-direction:column;position:absolute;bottom:76px;right:0;width:340px;max-width:calc(100vw - 32px);height:520px;max-height:calc(100vh - 140px);background:#fff;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,0.2);overflow:hidden;}" +
      "#cbank-chat-root.cbank-open #cbank-chat-window{display:flex;}" +
      "#cbank-chat-header{background:#0b3d91;color:#fff;padding:16px;position:relative;display:flex;align-items:flex-start;justify-content:space-between;gap:8px;}" +
      ".cbank-header-title{font-weight:700;font-size:15px;}" +
      ".cbank-header-subtitle{font-size:12px;opacity:0.85;margin-top:2px;}" +
      "#cbank-lang-btn{background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.4);color:#fff;font-size:11px;font-weight:700;border-radius:6px;padding:4px 8px;cursor:pointer;margin-top:1px;flex-shrink:0;}" +
      "#cbank-lang-btn:hover{background:rgba(255,255,255,0.25);}" +
      "#cbank-chat-close{position:absolute;top:10px;right:12px;background:transparent;border:none;color:#fff;font-size:22px;line-height:1;cursor:pointer;}" +
      "#cbank-chat-header:has(#cbank-lang-btn) #cbank-chat-close{position:static;margin-left:2px;}" +

      "#cbank-prechat{display:none;flex-direction:column;padding:18px;gap:8px;overflow-y:auto;background:#f4f6fb;flex:1;}" +
      "#cbank-prechat-title{font-weight:700;font-size:14.5px;color:#1a1a1a;}" +
      "#cbank-prechat-subtitle{font-size:12.5px;color:#666;margin-bottom:6px;}" +
      ".cbank-field-label{font-size:12.5px;font-weight:600;color:#333;margin-top:6px;}" +
      "#cbank-prechat input,#cbank-prechat select{border:1px solid #dcdfe6;border-radius:8px;padding:9px 12px;font-size:13.5px;outline:none;font-family:inherit;background:#fff;}" +
      "#cbank-prechat input:focus,#cbank-prechat select:focus{border-color:#0b3d91;}" +
      "#cbank-whatsapp-row{display:flex;gap:6px;}" +
      "#cbank-whatsapp-country{flex:0 0 42%;min-width:0;}" +
      "#cbank-whatsapp-number{flex:1;min-width:0;}" +
      "#cbank-prechat-error{color:#c0233a;font-size:12px;min-height:14px;}" +
      "#cbank-start-btn{background:#0b3d91;color:#fff;border:none;border-radius:20px;padding:10px 16px;font-weight:700;font-size:13.5px;cursor:pointer;margin-top:4px;}" +
      "#cbank-start-btn:hover{background:#092f70;}" +

      "#cbank-chat-body{display:none;flex-direction:column;flex:1;min-height:0;}" +
      "#cbank-chat-messages{flex:1;overflow-y:auto;padding:14px;background:#f4f6fb;display:flex;flex-direction:column;gap:8px;}" +
      ".cbank-msg{max-width:85%;padding:9px 12px;border-radius:14px;font-size:13.5px;line-height:1.4;word-wrap:break-word;white-space:pre-line;}" +
      ".cbank-msg-client{align-self:flex-end;background:#0b3d91;color:#fff;border-bottom-right-radius:4px;}" +
      ".cbank-msg-agent{align-self:flex-start;background:#fff;color:#1a1a1a;border:1px solid #e2e6ee;border-bottom-left-radius:4px;}" +
      ".cbank-msg-bot{align-self:flex-start;background:#eaf6f0;color:#1a1a1a;border:1px solid #c9ebd9;border-bottom-left-radius:4px;}" +
      ".cbank-bot-label{font-size:10.5px;font-weight:700;color:#1e8a5f;text-transform:uppercase;letter-spacing:0.4px;margin-bottom:3px;}" +
      ".cbank-msg-system{align-self:center;background:transparent;color:#8a8f98;font-size:12px;font-style:italic;white-space:normal;}" +
      "#cbank-chat-typing{display:none;font-size:12px;color:#8a8f98;padding:0 14px 6px;}" +

      "#cbank-faq-panel{display:none;flex-direction:column;gap:6px;padding:12px 14px;background:#fff;border-top:1px solid #e2e6ee;max-height:180px;overflow-y:auto;}" +
      "#cbank-faq-title{font-size:11.5px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:0.3px;margin-bottom:2px;}" +
      "#cbank-faq-list{display:flex;flex-direction:column;gap:6px;}" +
      ".cbank-faq-item{text-align:left;background:#f4f6fb;border:1px solid #e2e6ee;border-radius:8px;padding:8px 10px;font-size:12.5px;color:#0b3d91;cursor:pointer;font-family:inherit;}" +
      ".cbank-faq-item:hover{background:#eaf0fc;border-color:#c7d6f5;}" +
      "#cbank-faq-toggle{display:none;background:#fff;border:none;border-top:1px solid #e2e6ee;color:#0b3d91;font-size:12px;font-weight:600;padding:8px 14px;cursor:pointer;text-align:left;}" +
      "#cbank-faq-toggle:hover{background:#f4f6fb;}" +

      "#cbank-chat-inputbar{display:flex;border-top:1px solid #e2e6ee;padding:10px;gap:8px;background:#fff;}" +
      "#cbank-chat-input{flex:1;border:1px solid #dcdfe6;border-radius:20px;padding:9px 14px;font-size:13.5px;outline:none;}" +
      "#cbank-chat-input:focus{border-color:#0b3d91;}" +
      "#cbank-chat-send{background:#0b3d91;color:#fff;border:none;border-radius:20px;padding:9px 16px;font-size:13.5px;font-weight:600;cursor:pointer;}" +
      "#cbank-chat-send:hover{background:#092f70;}" +
      "@media (max-width:420px){#cbank-chat-window{right:-12px;}}";

    var style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }
})();
