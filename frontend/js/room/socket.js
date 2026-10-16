// Room WebSocket client, shared by the host screen and the phone page.
//
// Connects to /api/v1/rooms/<code>/ws on whatever host served the page (ws://
// or wss:// to match), sends {type:"hello", role, token} first, then exposes
// send(type, fields) which resolves with the server's reply for that action.
// Reconnects with backoff. A gap in seq means a missed message: it reconnects,
// and the welcome that follows carries the full current state.

const CLOSE = { unauthorized: 4401, kicked: 4403, notFound: 4404 };
const REPLY_TIMEOUT_MS = 8000;
// The server pings every room socket every 10 s. Hearing nothing for this long means the
// connection died without closing (e.g. Wi-Fi dropped silently): close it and reconnect.
const SILENCE_MS = 25000;

export function roomSocketUrl(code) {
  const u = new URL(`/api/v1/rooms/${encodeURIComponent(code)}/ws`, location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}

export function createRoomSocket({ code, role, token, onMessage, onStatus, onRejected }) {
  let ws = null;
  let attempt = 0;
  let lastSeq = null;
  let timer = 0;
  let stopped = false;
  let nextRef = 1;
  let lastHeard = Date.now();
  const pending = new Map(); // ref -> {resolve, reject, timer}

  function failPending(reason) {
    for (const [ref, p] of pending) { clearTimeout(p.timer); p.reject(new Error(reason)); pending.delete(ref); }
  }

  function connect() {
    clearTimeout(timer);
    onStatus(attempt === 0 ? "connecting" : "reconnecting");
    ws = new WebSocket(roomSocketUrl(code));
    ws.onopen = () => {
      lastSeq = null;
      lastHeard = Date.now();
      ws.send(JSON.stringify({ type: "hello", role, token: token() }));
    };
    ws.onmessage = (e) => {
      lastHeard = Date.now();
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (lastSeq !== null && msg.seq !== lastSeq + 1) { ws.close(); return; } // resync via a new welcome
      lastSeq = msg.seq;
      if (msg.type === "welcome") { attempt = 0; onStatus("open"); }
      if (msg.type === "ping") return; // keep-alive only
      if (msg.type === "reply") {
        const p = pending.get(msg.data.ref);
        if (p) { clearTimeout(p.timer); pending.delete(msg.data.ref); p.resolve(msg.data); }
        return;
      }
      onMessage(msg);
    };
    ws.onclose = (e) => {
      ws = null;
      failPending("disconnected");
      if (stopped) return;
      const reason = Object.keys(CLOSE).find((k) => CLOSE[k] === e.code);
      if (reason) { stopped = true; onStatus("offline"); onRejected(reason); return; }
      attempt += 1;
      onStatus(navigator.onLine === false ? "offline" : "reconnecting");
      const delay = Math.min(10000, 400 * 2 ** Math.min(attempt, 5)) * (0.75 + Math.random() * 0.5);
      timer = setTimeout(connect, delay);
    };
  }

  window.addEventListener("online", () => { if (!stopped && !ws) { attempt = 0; connect(); } });
  // The device lost its network: a socket can stay "open" for a long time without noticing,
  // so close it now. The page shows Offline and reconnects when the network returns.
  window.addEventListener("offline", () => { if (!stopped && ws) ws.close(); });
  // Phones freeze background tabs; reconnect as soon as the page is visible again.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !stopped && !ws) { attempt = 0; connect(); }
  });

  setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN && Date.now() - lastHeard > SILENCE_MS) ws.close();
  }, 5000);

  connect();

  return {
    send(type, fields = {}) {
      return new Promise((resolve, reject) => {
        if (!ws || ws.readyState !== WebSocket.OPEN) { reject(new Error("not connected")); return; }
        const ref = String(nextRef++);
        const t = setTimeout(() => { pending.delete(ref); reject(new Error("timeout")); }, REPLY_TIMEOUT_MS);
        pending.set(ref, { resolve, reject, timer: t });
        ws.send(JSON.stringify({ type, ref, ...fields }));
      });
    },
    stop() { stopped = true; clearTimeout(timer); ws?.close(); },
  };
}

export const store = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } },
  remove(key) { try { localStorage.removeItem(key); } catch { /* storage blocked */ } },
};
