"""Real-time channel: WebSocket broadcaster (contract §9).

``Broadcaster`` implements the engine's ``EventSink``. Each connection has its
own ``seq`` counter and its own send queue, so a slow client never blocks the
engine and a gap in ``seq`` really means that client missed an event.

Endpoint: ``GET /api/v1/ws?token=<guest token>`` (browsers cannot set an
Authorization header on a WebSocket, so the token goes in the query string).
Events go server -> client only; the server ignores anything the client sends.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Callable

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .auth import account_id_for_token
from .errors import GameError

log = logging.getLogger("ascent.realtime")

QUEUE_LIMIT = 1000
CLOSE_UNAUTHORIZED = 4401
CLOSE_TOO_SLOW = 4408


class _Connection:
    def __init__(self, ws: WebSocket, account_id: str) -> None:
        self.ws = ws
        self.account_id = account_id
        self.seq = 0
        self.queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=QUEUE_LIMIT)
        self.sender: asyncio.Task | None = None


class Broadcaster:
    """Fans engine events out to connected clients. Must be used on the event loop thread."""

    def __init__(self) -> None:
        self._conns: set[_Connection] = set()
        # Called when the set of connected players changes; main.py points it at the engine.
        self.on_presence: Callable[[], None] = lambda: None

    @property
    def connection_count(self) -> int:
        return len(self._conns)

    def online_count(self) -> int:
        """Distinct players connected (several tabs of one player count once)."""
        return len({c.account_id for c in self._conns})

    def _presence_changed(self) -> None:
        try:
            self.on_presence()
        except Exception:  # presence is cosmetic; never let it break a connection
            log.exception("presence update failed")

    def publish(self, event: dict, account_id: str | None = None) -> None:
        for conn in list(self._conns):
            if account_id is not None and conn.account_id != account_id:
                continue
            conn.seq += 1
            # Envelope order matches the contract: type, seq, roundId, data.
            message = {"type": event["type"], "seq": conn.seq}
            message.update((k, v) for k, v in event.items() if k != "type")
            try:
                conn.queue.put_nowait(message)
            except asyncio.QueueFull:
                # The client fell too far behind. Drop it; it will reconnect and resync.
                log.warning("dropping slow client %s", conn.account_id)
                self._conns.discard(conn)
                if conn.sender is not None:
                    conn.sender.cancel()
                asyncio.ensure_future(conn.ws.close(code=CLOSE_TOO_SLOW))

    async def serve(self, ws: WebSocket, account_id: str) -> None:
        conn = _Connection(ws, account_id)
        self._conns.add(conn)
        conn.sender = asyncio.create_task(self._send_loop(conn))
        self._presence_changed()
        try:
            while True:
                await ws.receive_text()  # ignored; keeps the socket read so disconnects are seen
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            self._conns.discard(conn)
            conn.sender.cancel()
            self._presence_changed()

    async def _send_loop(self, conn: _Connection) -> None:
        try:
            while True:
                await conn.ws.send_json(await conn.queue.get())
        except (WebSocketDisconnect, RuntimeError):
            self._conns.discard(conn)


router = APIRouter(prefix="/api/v1")


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    try:
        account_id = account_id_for_token(ws.query_params.get("token"))
    except GameError:
        await ws.close(code=CLOSE_UNAUTHORIZED)
        return
    services = ws.app.state.services
    services.ledger.ensure_account(account_id, services.config.defaultLanguage)
    await ws.accept()
    await services.broadcaster.serve(ws, account_id)
