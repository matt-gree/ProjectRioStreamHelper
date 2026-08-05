# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Tournament broadcast operators for Mario Superstar Baseball (MSB) events played via the Project Rio mod. Scale varies by event size: a solo streamer running the game, the stream, and PRSH simultaneously for smaller events, up to a dedicated producer working the Production console while separate commentators/on-air talent handle the broadcast for bigger ones. All operate PRSH locally on their own machine during a live (or recorded) match.

## Product Purpose

PRSH is a web-based tournament stream overlay manager. It ingests live MSB game data (a local HUD file, or Project Rio's public API), tracks scoreboards and tournament fixtures, and drives OBS browser-source overlays plus a Production console in real time — so the operator isn't hand-keying stream graphics during a match.

## Positioning

Unlike generic OBS overlay/graphics tooling, PRSH is purpose-built for one game. It understands Project Rio's HUD/API data shapes, MSB's characters/teams/stats, and tournament fixture flow (start.gg) natively, rather than being a generic template layer the operator has to wire up per event.

## Operating Context

Runs locally on the operator's machine (loopback-bound by default) alongside a running Project Rio game and OBS. Core workflows: bind a scoreboard to a live HUD game, a live API game, or a rotating pool of games; build OBS scenes from the Production console (rack / stage / quick rail); load tournament fixtures from start.gg and bind them to a scoreboard; manage participant identities and branding assets between games. Event scale ranges from a single-person livestream to a full crew with a dedicated producer and separate commentary talent.

## Capabilities and Constraints

- Ships as a standalone macOS/Windows app (PyInstaller) or run from source (`npm run dev`).
- Does not ship MSB game assets (Nintendo IP) — the operator supplies their own character/team-logo/game-icon pack.
- Binds to loopback (`127.0.0.1`) only by default; LAN access is opt-in, because PRSH exposes stateful APIs that can mutate the live broadcast.
- No native mobile app. The optional controller-input overlay (`gc-overlay`) is macOS-only.
- Console degrades gracefully with no OBS connection (catalog tier) — this is a deliberate design constraint, not a gap to fix.

## Brand Commitments

Name is "ProjectRioStreamHelper (PRSH)", forked from TournamentStreamHelper. No further confirmed brand assets beyond the product name and the current UI shown in README.md.

## Evidence on Hand

None beyond the current UI screenshot in README.md. No testimonials, case studies, or usage metrics on hand — future work must not fabricate any.

## Product Principles

- Understand one game deeply rather than be a generic overlay tool.
- Never let the console become a point of failure for a live broadcast — safe defaults (loopback binding) and graceful degradation (catalog tier without OBS) over convenience.
- Scale from a solo operator to a full producer-plus-talent crew without forcing either into the other's workflow.
- Game state is the single source of truth; overlays and UI are views of it, never a separate authority.
