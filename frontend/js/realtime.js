// WebSocket client for live events (docs/GAME_CONTRACT.md §9).
// Reconnects with backoff, reports a visible status, and asks for a resync
// (GET /rounds/current) on every (re)connect and whenever seq skips a number.

const CLOSE_UNAUTHORIZED = 4401;

export function createRealtime({ url, onEvent, onStatus, onResync }) {
  let ws = null;
  let attempt = 0;
  let lastSeq = null;
  let timer = 0;
  let stopped = true;

  function connect() {
    clearTimeout(timer);
    onStatus(attempt === 0 ? "connecting" : "reconnecting");
    ws = new WebSocket(url);
    ws.onopen = () => {
      attempt = 0;
      lastSeq = null;
      onStatus("open");
      onResync();
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      const gap = lastSeq !== null && msg.seq !== lastSeq + 1;
      lastSeq = msg.seq;
      onEvent(msg);
      if (gap) onResync();
    };
    ws.onclose = (e) => {
      ws = null;
      if (stopped) return;
      if (e.code === CLOSE_UNAUTHORIZED) { onStatus("offline"); return; }
      attempt += 1;
      onStatus("reconnecting");
      const delay = Math.min(15000, 500 * 2 ** Math.min(attempt, 5)) * (0.75 + Math.random() * 0.5);
      timer = setTimeout(connect, navigator.onLine === false ? 15000 : delay);
    };
  }

  window.addEventListener("online", () => { if (!stopped && !ws) { attempt = 0; connect(); } });

  return {
    start() { stopped = false; connect(); },
    stop() { stopped = true; clearTimeout(timer); ws?.close(); },
  };
}

/** ws(s)://host/api/v1/ws?token=... for an http(s) API base. */
export function websocketUrl(apiBase, token) {
  const u = new URL(apiBase + "/ws", location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  u.searchParams.set("token", token);
  return u.toString();
}
