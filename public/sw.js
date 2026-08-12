// cbank Agent Dashboard -- service worker
// Minimal: enables "Add to Home Screen" / install as an app, and is ready
// to receive real Web Push in the future. Today, notifications are shown
// directly by the page (pwa.js) via the Notification API while the
// dashboard tab is open -- same behavior as WhatsApp Web.

self.addEventListener("install", () => {
    self.skipWaiting();
});

self.addEventListener("activate", (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
    event.respondWith(
          fetch(event.request).catch(() => new Response("", { status: 503 }))
        );
});

self.addEventListener("push", (event) => {
    if (!event.data) return;
    let payload;
    try {
          payload = event.data.json();
    } catch (e) {
          payload = { title: "cbank Support", body: event.data.text() };
    }
    event.waitUntil(
          self.registration.showNotification(payload.title || "cbank Support", {
                  body: payload.body || "Tenes un mensaje nuevo.",
                  icon: "/icon.svg",
                  badge: "/icon.svg",
                  tag: payload.tag || "cbank-message",
          })
        );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(
          self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientsArr) => {
                  const existing = clientsArr.find((c) => c.url.includes("agent-dashboard.html"));
                  if (existing) return existing.focus();
                  return self.clients.openWindow("/agent-dashboard.html");
          })
        );
});
