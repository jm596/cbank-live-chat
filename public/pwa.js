// cbank Agent Dashboard -- installable icon + live notifications
//
// Loaded via a <script src="/pwa.js"> tag placed right before </body>, AFTER
// the dashboard's own inline <script> block -- so the `socket`, `sessions`,
// `activeSessionId` and `selectSession` bindings that script declares at
// top level are already live in the shared page scope by the time this
// file runs (classic <script> tags on the same page share one global
// lexical environment for let/const/function, this is standard browser
// behavior, not a hack).
//
// What this adds, mirroring WhatsApp Web:
// 1. Installable app icon (manifest + service worker registration) --
//    "Add to Home Screen" on iOS, "Install app" on Android/desktop Chrome.
// 2. A ding + a system notification whenever a session's `unread` count
//    goes up, i.e. a message that needs a human just arrived.
// 3. That ding + notification REPEATS every 60 seconds for as long as the
//    session's `needsReply` flag stays true on the server (cleared only
//    when an agent actually sends a reply), so an unanswered chat keeps
//    nagging instead of firing once and going silent.
// Notifications need the dashboard tab open (foreground or backgrounded),
// same requirement WhatsApp Web has -- this does not wake up from a fully
// closed browser without adding real Web Push (see sw.js's push handler,
// ready for that if you add VAPID keys later).

(function () {
      // ---- Install as an app --------------------------------------------
   if ("serviceWorker" in navigator) {
           navigator.serviceWorker.register("/sw.js").catch((err) => {
                     console.warn("[cbank] Service worker registration failed:", err);
           });
   }

   // ---- "Activar notificaciones" button in the sidebar header --------
 function addNotifyButton() {
     if (!("Notification" in window)) return;
     const header = document.querySelector("#sidebar header");
     if (!header || document.getElementById("notify-btn")) return;

    const btn = document.createElement("button");
     btn.id = "notify-btn";
     btn.type = "button";
     btn.style.cssText =
         "margin-top:8px;margin-left:8px;background:rgba(255,255,255,0.15);" +
         "border:1px solid rgba(255,255,255,0.4);color:#fff;font-size:12px;" +
         "font-weight:600;border-radius:6px;padding:6px 10px;cursor:pointer;";

    function refreshLabel() {
        if (Notification.permission === "granted") {
            btn.textContent = "\u{1F514} Notificaciones activadas";
            btn.disabled = true;
            btn.style.opacity = "0.7";
            btn.style.cursor = "default";
        } else if (Notification.permission === "denied") {
            btn.textContent = "\u{1F515} Notificaciones bloqueadas";
            btn.disabled = true;
            btn.style.opacity = "0.7";
            btn.style.cursor = "default";
        } else {
            btn.textContent = "\u{1F514} Activar notificaciones";
        }
    }
     refreshLabel();

    btn.addEventListener("click", () => {
        Notification.requestPermission().then(refreshLabel);
    });

    header.appendChild(btn);
 }

 if (document.readyState === "loading") {
     document.addEventListener("DOMContentLoaded", addNotifyButton);
 } else {
     addNotifyButton();
 }

   // ---- Ding sound (Web Audio, no external file needed) ----------------
 let audioCtx = null;
    function ping() {
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = "sine";
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.2, audioCtx.currentTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.35);
            osc.connect(gain).connect(audioCtx.destination);
            osc.start();
            osc.stop(audioCtx.currentTime + 0.35);
        } catch (e) {
            // Audio isn't critical -- ignore failures (autoplay policy, etc.)
        }
    }

 function notifyForSession(s) {
     const currentActiveId = typeof activeSessionId !== "undefined" ? activeSessionId : null;
     const isOpenAndFocused = s.id === currentActiveId && !document.hidden;

    ping();

    if (!isOpenAndFocused && "Notification" in window && Notification.permission === "granted") {
        const n = new Notification("\u{1F4AC} " + (s.name || "Nuevo mensaje"), {
            body: s.lastMessage || "Tenes un mensaje nuevo.",
            icon: "/icon.svg",
            tag: "cbank-session-" + s.id,
        });
        n.onclick = () => {
            window.focus();
            if (typeof selectSession === "function") selectSession(s.id);
            n.close();
        };
    }
 }

   // ---- Watch sessions:list for messages that need a human -------------
 if (typeof socket === "undefined") return;

 const previousUnread = {};
    let primed = false; // don't notify for the pre-existing backlog on first load
 let latestSessions = [];

 socket.on("sessions:list", (list) => {
     latestSessions = list;

           if (!primed) {
               list.forEach((s) => {
                   previousUnread[s.id] = s.unread || 0;
               });
               primed = true;
               return;
           }

           list.forEach((s) => {
               const prev = previousUnread[s.id] || 0;
               const curr = s.unread || 0;

                        if (curr > prev) notifyForSession(s);

                        previousUnread[s.id] = curr;
           });
 });

   // Keep nagging every 60s for every session still waiting on a human
   // reply, until an agent actually answers (server clears needsReply
   // when an agent message is sent, or the conversation is closed).
 setInterval(() => {
     latestSessions.forEach((s) => {
         if (s.needsReply) notifyForSession(s);
     });
 }, 60000);
})();
