# Character Spotlight Final Polish Pass

The Character Spotlight redesign is very close to complete. This pass should focus entirely on polish, consistency, and refining the user experience rather than introducing new features.

I want Fable to own the overall design review and visual decisions.

As before, create a checklist from this prompt and keep it updated until every requested item has either been implemented or discussed.

The goal of this pass is that the scene feels cohesive rather than a collection of individually implemented features.

---

# Animation Timing & Flow

The overall pacing of the replay still needs refinement.

## AB Chips

Synchronize the AB chips with the replay.

Rather than appearing immediately, each chip should appear when the result of that at-bat becomes known (generally when the ball lands or the play concludes).

This should make the replay feel more synchronized with the gameplay.

---

## Replay Flow

Begin each at-bat with the large:

> Inning • Outs

transition card.

Currently the UI briefly shows the game situation, transitions to the inning card, then immediately returns to the situation.

Instead, the inning transition should establish the new at-bat before any other game-state information appears.

---

## Between At-Bats

The camera reset between consecutive hits still feels abrupt.

Perform the reset while the inning transition card is displayed so the viewer never watches the camera snap back into position.

---

## Non-Batted Ball Events

If the next at-bat does not generate a Rio Visualizer trajectory (strikeout, HBP, walk, etc.), reset the Rio Visualizer immediately after the previous play while maintaining the same timing described above.

---

# Camera Polish

Overall I like the current direction. The remaining work is making the camera feel more intentional.

## Home Runs

If practical, detect collisions with the outer stadium mesh/wireframe and stop the tracked ball there instead of allowing it to clip through stadium geometry.

---

## Short Hits

The current shallow-hit camera is too subtle.

I'd like it to feel much closer to the big-hit treatment with:

- a slightly wider framing
- gentler motion
- smoother acceleration

The goal is consistency while still distinguishing shallow and deep hits.

---

## Spray Chart Camera

The current rocking motion is moving in the right direction.

However:

- Home plate should always remain visible.
- Every hit marker and trail should remain visible throughout the animation.
- Increase the viewing angle slightly to provide a more aerial perspective.
- Continue using a slow rocking/orbiting movement rather than dramatic camera motion.

The camera should showcase the completed spray chart rather than call attention to itself.

---

## Simulation Frame

Remove the inning/out situation text from the upper-left corner of the Rio Visualizer.

That information is already communicated elsewhere and doesn't need to compete with the visualization.

---

# Ball Trails

The trail effects are in a good place overall.

A few remaining polish items:

- Keep Home Run gradient trails looping while displayed on the spray chart.
- Keep Star Hit gradient trails looping while displayed on the spray chart.
- If a Star Hit ultimately results in an out, transition the trail from yellow to red.

---

# Stat Cards

The overall layout is much stronger now.

This pass should focus on spacing, timing, and information density.

## Card Spacing

The left-side cards currently sit too close to the frame border.

Match the left padding to the existing right-side spacing.

---

## Defensive & Pitching Stats

Populate these cards immediately at the beginning of the replay rather than revealing them during the AB walk.

Also include the defensive position where each recorded out occurred.

---

## Defensive Layout

If only a single defensive statistic exists, reduce the width of the defensive card rather than leaving a large empty card.

Keep it aligned cleanly to the appropriate edge.

---

## Batting Card

A few remaining adjustments:

- Remove the "H-AB" label.
- Remove the repeated Game Line section from the lower cards since it duplicates information already shown.
- Delay displaying OBP and SLG until the AB walkthrough has completed.
- Once they appear, animate the remaining statistics to make room rather than having them instantly pop into place.

---

## Star Accounting

The Star Hit / Star Spent values currently disagree with the AB chips.

Review the entire at-bat when calculating stars.

Specifically:

- Captain-eligible characters (Mario, Luigi, Wario, etc.) spend two stars on a Star Swing when they are not the team captain.
- A fouled Star Swing still counts as two stars spent.
- A successful Star Hit also counts as two stars spent.

The totals shown throughout the scene should always remain consistent.

---

## Hero Background

Increase the team logo size while keeping it vertically centered.

Currently the hero render obscures almost the entire logo.

The logo should remain visible enough to reinforce team identity without competing with the featured player.

---

# Frame Layout

## Score Frame

Display both player names above the score during the AB walkthrough.

---

## Baseball Diamond

Center the inning indicator within the baseball diamond.

Currently it overlaps second base.

---

# Contact Labels

Currently Perfect contact is labeled.

Please also label:

- Nice Contact
- Sour Contact

using the same presentation style.

---

# Bunt Detection

Some stat files incorrectly record:

Type of Swing = None

even though the ball was contacted during a bunt.

If contact occurs and the swing type is recorded as None, assume the play was a bunt and label it accordingly.

---

# AB History Layout

The number of reserved AB slots should match the player's actual number of plate appearances.

Currently players with four ABs in games where teammates had five still reserve five slots.

Each player's history should only reserve the number of slots they actually use.

---

# Final Review

Once every implementation is complete, perform one final holistic review.

Evaluate the scene as a finished broadcast package rather than checking off individual features.

In particular, review:

- Overall visual hierarchy
- Motion consistency
- Camera readability
- Timing of transitions
- Card spacing
- Typography
- Animation polish
- Information density
- Consistency between statistics shown in different parts of the UI

If any element still feels visually distracting, awkwardly timed, inconsistent, or unfinished, make one final polish pass before considering the work complete.

This should feel like release-quality broadcast graphics.