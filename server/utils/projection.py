"""Startup-projection guard shared by the projector models.

CLAUDE.md projector rules: every model's ``project_all()`` startup hook must
log and no-op on failure — a bad persisted record never blocks boot. This is
that try/except, written once (Match, Commentary, PlayerPlates, ...).
"""
from loguru import logger


async def run_startup_projection(label: str, coro) -> None:
    """Await a projector's startup re-projection, logging any failure."""
    try:
        await coro
    except Exception:
        logger.exception("[{}] startup projection failed", label)
