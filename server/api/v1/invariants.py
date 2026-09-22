"""Cross-subsystem invariant check — read-only diagnostics.

Serves `server/invariants.py` so a caller outside the process (the agent CLI's
`doctor --assert`, a smoke script, a producer filing a bug) runs the same list a
test does, rather than re-deriving "healthy" in a second place.
"""
from fastapi import APIRouter
from fastapi.responses import ORJSONResponse

from server import invariants
from server.utils.router import method

router = APIRouter()


@method(
    router.get, "/invariants",
    version="1", id="invariants.check",
    response_class=ORJSONResponse
)
async def invariants_check(session_id: str | None = None) -> ORJSONResponse:
    """Run every cross-subsystem check against the live State + Settings.

    Always 200 — a violation is a finding to report, not a failed request, and a
    caller polling this during a broadcast should never see it as an outage.
    """
    results = invariants.run()
    return ORJSONResponse({
        "ok": all(not r["violations"] for r in results),
        "checks": results,
        "violations": [f"{r['id']}: {v}" for r in results for v in r["violations"]],
    })
