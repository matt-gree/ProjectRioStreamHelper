"""Universal action bus — POST /action rebroadcasts to every connected client
as a `v1.action` SocketIO event. Actions are ephemeral one-shot cues (never
stored in State): "conceal yourself", "replay an animation". PRSH owns the
action vocabulary; overlay-base.js is the overlay-side consumer.

Current actions:
  overlay.conceal  payload: {url}
      Asks the overlay page(s) loaded from `url` to snap transparent NOW,
      while OBS is still compositing the source. The Production page sends
      this right before disabling a PRSH browser source: OBS stops a hidden
      source's frame production instantly and keeps its last painted GPU
      texture, so without the conceal the retained frame is full-alpha and
      flashes when the source is re-enabled (the appear→vanish→replay
      stutter). See obs.jsx setSceneItemEnabled and overlay-base.js
      onObsShown for the two ends of the handshake.
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import ORJSONResponse
from pydantic import BaseModel

from server import socketio

router = APIRouter(tags=["action"])


class Action(BaseModel):
    action: str
    payload: dict = {}


@router.post("/action", response_class=ORJSONResponse)
async def action_post(body: Action):
    """Broadcast a one-shot action cue to all connected clients."""
    if not body.action:
        raise HTTPException(400, "action required")
    await socketio.emit("v1.action", {"action": body.action, "payload": body.payload})
    return {"success": True}
