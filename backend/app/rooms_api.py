"""Multiplayer routes: room HTTP endpoints, the room WebSocket and the pages.

HTTP (base /api/v1):
- ``POST /rooms``                     host a game -> room code + host token
- ``GET  /rooms/{code}``              public room info for the join page
- ``POST /rooms/{code}/players``      join with a name -> player id + session token

WebSocket ``/api/v1/rooms/{code}/ws``: the first message must be
``{"type": "hello", "role": "host" | "player", "token": "..."}``. Tokens go in
that message, not the URL, so they never show up in access logs. After the
welcome, the client sends actions and gets one ``reply`` per action:

- player: ``place_bet`` {roundId, wager, autoCashOut?, idempotencyKey}, ``cash_out`` {roundId, idempotencyKey}
- host:   ``start``, ``lock`` {locked}, ``kick`` {playerId}

Bets and cash outs run through ``commands`` exactly like the HTTP routes in
``api.py``: same validation, same engine and ledger, same idempotency handling.

Pages: ``/host`` (host screen) and ``/join/{code}`` (phone).
"""

from __future__ import annotations

import asyncio
import json
import logging

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, ValidationError

from . import commands
from .config import REPO_ROOT
from .errors import GameError
from .money import format_credits
from .rooms import CLOSE_ROOM_NOT_FOUND, CLOSE_UNAUTHORIZED, Room, Seat
from .schemas import PlaceBetRequest, wire

log = logging.getLogger("ascent.rooms")

FRONTEND_DIR = REPO_ROOT / "frontend"
HELLO_TIMEOUT_S = 10
REF_MAX = 64

router = APIRouter(prefix="/api/v1")
pages = APIRouter(include_in_schema=False)


def registry(request: Request):
    return request.app.state.services.rooms


class JoinRequest(BaseModel):
    name: str


@router.post("/rooms", status_code=201)
async def create_room(request: Request):
    room, host_token = registry(request).create_room()
    return {"roomCode": room.code, "hostToken": host_token,
            "publicBaseUrl": room.settings.public_base_url, "playMoney": True}


@router.get("/rooms/{code}")
async def get_room(request: Request, code: str):
    room = registry(request).get(code)
    return {"roomCode": room.code, "locked": room.locked, "started": room.started,
            "playerCount": len(room.active_seats()), "maxPlayers": room.settings.max_players_per_room,
            "startingBalance": format_credits(room.config.starting_balance_units), "playMoney": True}


@router.post("/rooms/{code}/players", status_code=201)
async def join_room(request: Request, code: str, body: JoinRequest):
    room = registry(request).get(code)
    seat, token = room.join(body.name)
    return {"roomCode": room.code, "playerId": seat.player_id, "name": seat.name, "sessionToken": token,
            "balance": format_credits(room.ledger.get_account(seat.player_id).balance), "playMoney": True}


@router.websocket("/rooms/{code}/ws")
async def room_socket(ws: WebSocket, code: str) -> None:
    await ws.accept()
    try:
        hello = json.loads(await asyncio.wait_for(ws.receive_text(), HELLO_TIMEOUT_S))
    except (asyncio.TimeoutError, WebSocketDisconnect, RuntimeError, ValueError):
        await _close(ws, CLOSE_UNAUTHORIZED)
        return
    try:
        room = ws.app.state.services.rooms.get(code)
    except GameError:
        await _close(ws, CLOSE_ROOM_NOT_FOUND)
        return
    try:
        if not isinstance(hello, dict) or hello.get("type") != "hello":
            raise GameError("UNAUTHORIZED", "The first message must be hello.")
        if hello.get("role") == "host":
            room.check_host(hello.get("token"))
            seat = None
        elif hello.get("role") == "player":
            seat = room.authenticate_player(hello.get("token"))
        else:
            raise GameError("UNAUTHORIZED", "role must be host or player.")
    except GameError:
        await _close(ws, CLOSE_UNAUTHORIZED)
        return

    conn = room.broadcaster.connect(ws, seat.player_id if seat else None)
    lobby_changed = room.attach(seat)
    room.broadcaster.send(conn, {"type": "welcome", "data": room.welcome_data(seat)})
    if lobby_changed:
        room.broadcast_lobby()
    try:
        while True:
            text = await ws.receive_text()
            reply = handle_message(room, seat, text)
            room.broadcaster.send(conn, {"type": "reply", "data": reply})
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        room.broadcaster.disconnect(conn)
        room.detach(seat)


async def _close(ws: WebSocket, code: int) -> None:
    try:
        await ws.close(code=code)
    except RuntimeError:
        pass


def handle_message(room: Room, seat: Seat | None, text: str) -> dict:
    """Run one client action and return the reply: HTTP-style ``status`` and ``body``."""
    try:
        msg = json.loads(text)
    except ValueError:
        msg = None
    if not isinstance(msg, dict):
        msg = {}
    ref = msg.get("ref") if isinstance(msg.get("ref"), str) and len(msg["ref"]) <= REF_MAX else None
    action = msg.get("type") if isinstance(msg.get("type"), str) else None
    replayed = False
    try:
        if action in ("place_bet", "cash_out"):
            status, body, replayed = _player_action(room, seat, action, msg)
        elif action in ("start", "lock", "kick"):
            status, body = _host_action(room, seat, action, msg)
        else:
            raise GameError("INVALID_REQUEST", f"Unknown message type {action!r}.")
    except GameError as err:
        status, body = err.status, err.body()
    return {"ref": ref, "action": action, "status": status, "body": body, "replayed": replayed}


def _player_action(room: Room, seat: Seat | None, action: str, msg: dict) -> tuple[int, dict, bool]:
    if seat is None:
        raise GameError("FORBIDDEN", "Only players can bet or cash out.")
    round_id = msg.get("roundId")
    if not isinstance(round_id, str):
        raise GameError("INVALID_REQUEST", "roundId is required.")
    key = msg.get("idempotencyKey") if isinstance(msg.get("idempotencyKey"), str) else None
    if action == "place_bet":
        try:
            req = PlaceBetRequest.model_validate({k: msg[k] for k in ("wager", "autoCashOut") if k in msg})
        except ValidationError as err:
            raise GameError("INVALID_REQUEST", "; ".join(e["msg"] for e in err.errors())) from None
        fingerprint = f"WS place_bet {round_id} {json.dumps(wire(req), sort_keys=True)}"
        return commands.run_idempotent(
            room.idempotency, seat.player_id, key, fingerprint,
            lambda: commands.place_bet(room.engine, seat.player_id, round_id, req))
    fingerprint = f"WS cash_out {round_id} {{}}"
    return commands.run_idempotent(
        room.idempotency, seat.player_id, key, fingerprint,
        lambda: commands.cash_out(room.engine, seat.player_id, round_id))


def _host_action(room: Room, seat: Seat | None, action: str, msg: dict) -> tuple[int, dict]:
    # A socket is a host socket only if its hello carried the room's host token.
    if seat is not None:
        raise GameError("FORBIDDEN", "Only the host can do that.")
    if action == "start":
        room.start()
    elif action == "lock":
        if not isinstance(msg.get("locked"), bool):
            raise GameError("INVALID_REQUEST", "locked must be true or false.")
        room.set_locked(msg["locked"])
    else:
        if not isinstance(msg.get("playerId"), str):
            raise GameError("INVALID_REQUEST", "playerId is required.")
        room.kick(msg["playerId"])
    return 200, {"ok": True}


@pages.get("/host")
async def host_page():
    return FileResponse(FRONTEND_DIR / "host.html")


@pages.get("/join")
async def join_page_no_code():
    return FileResponse(FRONTEND_DIR / "join.html")


@pages.get("/join/{code}")
async def join_page(code: str):
    if code != code.upper():
        return RedirectResponse(f"/join/{code.upper()}")
    return FileResponse(FRONTEND_DIR / "join.html")
