# cbank Live Chat

A real-time live chat support system for cbank clients: an embeddable widget
for the website plus an agent dashboard to answer chats — connected over
WebSockets.

## What's included

- `server.js` — Express + Socket.io server that routes messages between
  clients and agents. Sessions and message history live in memory.
- `public/widget.js` — the embeddable client-facing chat widget. Single
  script tag, no build step.
- `public/widget-demo.html` — a mock cbank page with the widget embedded, so
  you can see what a client sees.
- `public/agent-dashboard.html` — the agent-facing view: conversation list on
  the left, live message thread on the right.

## Running it locally

```bash
cd cbank-live-chat
npm install
npm start
```

Then open:

- `http://localhost:3000/widget-demo.html` — the client-facing page with the
  chat bubble in the bottom-right corner.
- `http://localhost:3000/agent-dashboard.html` — the agent dashboard, in a
  separate tab or browser.

Send a message from the widget, then watch it appear instantly in the agent
dashboard. Reply as the agent and it lands back in the widget in real time.

## Embedding on cbank's real site

Drop this one line wherever you want the chat bubble to appear (usually just
before `</body>`):

```html
<script src="https://chat.cbank.example/widget.js"></script>
```

If the widget is served from a different origin than your main site, pass
the chat server's URL explicitly:

```html
<script
  src="https://chat.cbank.example/widget.js"
  data-server="https://chat.cbank.example">
</script>
```

The widget remembers each visitor's session in `localStorage`, so if they
close the tab and come back, they resume the same conversation instead of
starting a new one.

## Pre-chat form & language

Before a visitor's first message, the widget shows a short form asking for
name, email, and WhatsApp number — the number field is a country-code
dropdown (20 common Latin America / US / Canada / Iberia codes) next to a
plain number input, so visitors never have to type their own country code.
All UI text — including the welcome message — is localized in Spanish,
English, and Portuguese, auto-detected from the browser's language and
switchable any time via the visible language button in the chat header,
which cycles ES → EN → PT. The visitor's answers and locale choice are
remembered in `localStorage`, so returning visitors skip straight to the
conversation.

To add another language, add a new key to the `I18N` object and to the
`LOCALES` array in `public/widget.js`, with the same fields as `en`/`es`/`pt`.
To add/remove country codes, edit the `COUNTRY_CODES` array in the same file.

## Welcome bot & FAQ menu

As soon as a visitor's chat opens for the first time, a bot message greets
them and shows a menu of frequently-asked questions (seeded from the real
FAQ content on [cbank.ws](https://cbank.ws) / [cbank.ws/support](https://cbank.ws/support),
translated into Spanish, English, and Portuguese). Clicking a question gets
an instant answer from the bot — no agent needed — while still logging both
the question and answer into the conversation, so they show up in the agent
dashboard and in the emailed transcript with a distinct green "cbank Bot"
styling (as opposed to blue for a human agent). A "❓ Frequently asked
questions" button near the input reopens the menu at any time; if a visitor
just types a free-text message instead, that goes through the normal
human-agent flow untouched.

**Agents manage the FAQ list from the dashboard** — click "❓ Gestionar
preguntas frecuentes" in the sidebar to add, edit, or delete questions. Each
question/answer pair has separate fields for Spanish, English, and
Portuguese; at least one language is required per field, and the widget
falls back to whichever language is filled in (es → en → pt) for a visitor
whose locale doesn't have a translation yet. Changes broadcast instantly to
every open widget and dashboard — no restart needed. Like the rest of this
app, the FAQ list lives in memory and resets to the seeded defaults on
restart; see point 1 under "Going to production" for making it durable.

## Visitor context: country, city, device, IP

The server automatically detects, with no input from the visitor:

- **IP address** — read from the socket connection (respecting
  `X-Forwarded-For` if you're behind a proxy/load balancer, which Railway and
  Render both are).
- **Country & city** — looked up from that IP via the free
  [ip-api.com](https://ip-api.com) endpoint (`geolocateIp` in `server.js`),
  cached per IP. This resolves a moment after the visitor connects (shown as
  "Detecting…" briefly in the dashboard), and only works for public IPs — on
  `localhost` it will show "Local/Unknown", which is expected in local
  testing. The free tier is rate-limited (~45 req/min); swap in a paid
  provider if you outgrow it.
- **Device** — parsed client-side from the browser's user agent
  (`detectDevice()` in `widget.js`) into something readable like "Chrome on
  macOS (Desktop)".

All of this shows up in the agent dashboard's conversation header and in the
conversation list, next to each visitor's name.

## Transcript emails on close

When an agent clicks **Close conversation**, the server emails the full
transcript to the visitor's email address and shows the send status live in
the dashboard header (Sending… / Sent / Failed / Not configured / Skipped —
no email on file). This uses [Nodemailer](https://nodemailer.com/) over
plain SMTP, so it works with your existing mailbox, Gmail (via an
[App Password](https://myaccount.google.com/apppasswords), not your normal
password), or any transactional email provider (SendGrid, Postmark, Mailgun,
Resend, etc. all offer SMTP credentials).

Set it up: copy `.env.example` to `.env` and fill in `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (and optionally `MAIL_FROM`). Without
a `.env`, the server still runs fine — it just marks every close as
"not-configured" instead of sending anything, so nothing breaks in local
testing.

**Agents keep access to closed conversations from the dashboard itself** —
the sidebar has *Todas / Activas / Cerradas* (All/Active/Closed) tabs, and
clicking a closed conversation still shows the full message thread and the
transcript-email status. Note this history lives in the same in-memory store
as everything else, so it survives page reloads but not a server restart —
see point 1 below for making it durable across restarts.

## WhatsApp Business bot

The server also runs a WhatsApp channel on top of the same Meta Cloud API
webhook, reusing the exact FAQ content agents manage from the dashboard.
WhatsApp conversations show up in the same agent dashboard as web chats,
tagged with a green "WhatsApp" badge — replying from the dashboard sends
the message back over WhatsApp automatically.

How it works:

- A visitor messages your WhatsApp number. Their **first message ever**
  (or the word "menu"/"hola"/"hi") gets an instant numbered list of FAQ
  questions, sent back as a WhatsApp text message.
- Replying with a number (e.g. "3") gets that FAQ's answer instantly — no
  agent needed, same as clicking a question in the web widget.
- Any other free-text message is logged and left **unread for a human
  agent**, who sees and replies to it from the dashboard like any other
  conversation. The reply is delivered back over WhatsApp.
- Everything is logged into the same in-memory session store as web chat,
  so it resets on restart along with everything else (see point 1 below).

### Setup

1. **Environment variables** — copy `.env.example` to `.env` (same file as
   SMTP) and fill in the `WHATSAPP_*` block. Get the values from
   [Meta for Developers](https://developers.facebook.com/apps/) → your app
   → WhatsApp → API Setup:
   - `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_BUSINESS_ACCOUNT_ID` — shown
     next to your number (the free test number while developing).
   - `WHATSAPP_ACCESS_TOKEN` — the token generated there, or via
     **Tools → Graph API Explorer**, selecting your app and adding the
     `whatsapp_business_management` + `whatsapp_business_messaging`
     permissions before generating. That token is short-lived (~1-2h) —
     fine for testing, but see point 9 below for production.
   - `WHATSAPP_VERIFY_TOKEN` — any string you make up. Use the same value
     when registering the webhook on Meta's side (next step).

2. **Register the webhook** — your server needs a public HTTPS URL for
   Meta to reach (localhost won't work). While developing, run
   [ngrok](https://ngrok.com/) (`ngrok http 3000`) and use the `https://...`
   URL it gives you; once deployed (e.g. to Railway), use that URL instead.
   In Meta for Developers → your app → WhatsApp → Configuration:
   - Callback URL: `https://your-url/webhooks/whatsapp`
   - Verify token: the same `WHATSAPP_VERIFY_TOKEN` from your `.env`
   - Subscribe to the `messages` webhook field.

3. **Add yourself as a test recipient** — while using the free test
   number, only phone numbers you've explicitly added in Meta's dashboard
   (API Setup → "To" field → manage phone number list) can message it and
   receive replies from it. Add your own WhatsApp number there before
   testing end to end.

4. **Test it** — message the test number from your added phone. You
   should get the FAQ menu back instantly, and the conversation should
   appear in the agent dashboard tagged "WhatsApp".

## Going to production

This build is intentionally minimal so it's easy to understand and extend.
Before putting it in front of real customers:

1. **Persist sessions and messages to a real database** (Postgres, Mongo,
   Redis) instead of the in-memory `Map` in `server.js`. As written, all
   conversation history is lost on server restart.
2. **Add agent authentication.** The dashboard currently has none — anyone
   with the URL can read and reply to every conversation. Put it behind your
   SSO/login and scope `agent:join` to authenticated staff only.
3. **Lock down CORS.** `server.js` currently allows any origin
   (`cors: { origin: "*" }`). Restrict this to cbank's actual domain(s).
4. **Add rate limiting** on `client:message` to prevent spam/abuse from a
   single visitor.
5. **Capture client identity** (logged-in account, name, email) instead of
   the generic "cbank client" placeholder, so agents have context.
6. **Add transport security.** Deploy behind HTTPS/WSS (e.g. behind nginx or
   a platform like Render/Fly.io/Heroku) — browsers will block a WSS widget
   from connecting to a plain `ws://` server on a live HTTPS site.
7. **Horizontal scaling.** If you run more than one server process, add the
   [Socket.io Redis adapter](https://socket.io/docs/v4/redis-adapter/) so
   messages route correctly across instances.
8. **Compliance.** Since this is a banking product, loop in your compliance/
   security team on data retention, PII handling in chat transcripts, and
   whether conversations need to be archived or encrypted at rest. The
   widget now also collects IP address, approximate location, device info,
   and a WhatsApp number — add a privacy notice/consent line to the pre-chat
   form and confirm retention rules for all of it (not just messages) before
   launch.
9. **Protect SMTP credentials.** Never commit a real `.env` file — it's
   already in `.gitignore`. On Railway/Render, set `SMTP_HOST` / `SMTP_USER` /
   `SMTP_PASS` / `MAIL_FROM` as environment variables in the platform's
   dashboard instead.
10. **Move off the free WhatsApp test number.** The test number and its
    short-lived access token are for development only (max 5 recipients,
    token expires every 1-2 hours). For production: buy/port a real number
    (this is where the eSIM comes in — a SIM you control is required to
    receive the verification SMS/call when registering the number), verify
    cbank's business in Meta Business Manager, and generate a permanent
    **System User** access token (Meta Business Settings → System Users)
    instead of a Graph API Explorer token — that one doesn't expire.

## How it works, briefly

- The widget and dashboard are both Socket.io clients connected to the same
  server.
- Each visitor gets a `sessionId` (a UUID) the first time they open the
  widget; it's stored in `localStorage` so refreshing the page resumes the
  same conversation.
- The server keeps every session's message history in memory and broadcasts:
  - `message:new` to everyone watching that specific session (the visitor's
    widget + any agent who has it open).
  - `sessions:list` to all connected agents, so the dashboard's conversation
    list stays live without polling.
- Typing indicators are relayed both directions (`client:typing` /
  `agent:typing`) purely for UI feedback — nothing is persisted.
