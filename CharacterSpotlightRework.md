# Character Spotlight Redesign

We're doing another design pass on the Character Spotlight scene. There are a number of layout, animation, visualization, and polish changes I'd like to make. I want you to act as the project manager for this effort.

Break the work into logical groups (for example: Layout/UI, Animation, Visualizer, and Bug Fixes) and spin up subagents to tackle each group independently. Review their work, iterate with them when necessary, and integrate the results into a cohesive final implementation. If you find a better solution than one I've proposed that better satisfies the overall goals, explain the tradeoff and use your judgment.

Before making any changes, create a checklist from this prompt and keep it updated throughout the implementation so every requested feature is accounted for. As each task is completed, mark it off. At the end, verify that every item has either been implemented or explicitly discussed if it was deferred.

## Overall Design Goals

The overall goal is to improve readability, visual hierarchy, and presentation without sacrificing useful information.

Design principles:

- The featured player should be **one of the primary visual focuses** of the scene.
- The current at-bat should always be easy to follow.
- Information should feel naturally arranged instead of looking like it's reserving space for optional content.
- Remove unnecessary visual clutter.
- Improve transitions so the scene tells a clearer story as the replay progresses.
- Exciting moments, especially home runs, should feel significantly more cinematic.
- Favor layouts that adapt gracefully when optional statistics are absent.

---

# Layout

The hero render should be larger than it currently is. This will likely require reorganizing the stat cards rather than simply scaling the image.

## Player Header

The player callout in the upper-left currently contains the player name and character information.

I'd also like it to include:

- Event
- Bracket
- Phase

We can remove the team logo from this section since the team identity is already represented in the background artwork.

---

## Batting Statistics

I'd like to consolidate the batting information into a single full-width card.

Changes:

- Merge the current Batting card with the H-AB card.
- Remove Strikeouts (these are already represented in the AB history).
- Only display Stolen Bases if the value is greater than zero.
- Continue displaying Star Hit / Star Spent.
- Replace AVG with:
  - OBP
  - SLG

The goal is a denser, cleaner card that occupies the full width of the left column.

---

## Pitching & Defense

Pitching and Defense should become optional half-width cards beneath the batting card.

If the featured player didn't pitch or didn't have defensive stats, the remaining layout should naturally expand instead of reserving empty space.

Additional tweaks:

- Replace ERA with ER.
- Rename "Slide Catch" to "Sliding Catch."

I imagine the left column being approximately:

- Top half: statistics
- Bottom half: hero render

If a different layout better satisfies the overall design goals, feel free to propose it.

---

# At-Bat History Chips

The AB history should begin empty and build as the replay progresses.

Each chip should animate in individually as its at-bat occurs.

Improvements:

- The chips currently appear dimmed. They should have normal visual prominence.
- Continue to highlight the stars used in an AB, but right now they are in the corner and clipping off of the edge. Find a spot for them
- Review the entire AB and display every star consumed during that AB, not just the final state.

---

# Game State Bar

The current game-state bar is difficult to understand quickly.

I'd like to rethink this area.

## Between At-Bats

When transitioning between at-bats, temporarily transform the entire bar into a large transition card displaying something similar to:

> 9th Inning • 2 Outs

After a brief pause, smoothly transition back into the normal scoreboard.

I think this will make the replay much easier to follow.

---

## Scoreboard Layout

Please review the overall organization.

Current thoughts:

- Outs and Count feel unnecessarily separated.
- If grouped together, they likely don't need labels.
- Give the current pitcher their character icon.
- The Stars section currently feels visually off-center because it reserves room for future star changes.
- There needs to be an inning number down on this side

More generally, I don't want any UI element to appear like it's reserving empty space for something that may or may not exist.

The layout should feel balanced whether optional information is present or absent.

---

## End of Replay

When the replay finishes, transition the game-state bar into a finished/final score presentation instead of leaving it looking like an in-game scoreboard.

---

# Rio Visualizer

There are several improvements I'd like here.

## Camera

The current fixed camera struggles to communicate where deep fly balls actually land.

I'd like you to explore multiple camera systems and recommend several options. Developing multiple optional angls that are built into rio visuzalizer will be useful beyond just this stat card.

Don't assume we're limited to orbit cameras.

In particular:

- Home runs should receive a much more dramatic hero camera.
- The current dolly movement doesn't add enough excitement.
- Consider orbiting, tracking shots, pans, zooms, rotations, or entirely different movement systems.

The goal is to better sell big moments.

---

## Ball Trails

The ball trail currently renders in its entirety at the start of the play, with the ball simply traveling along an already-visible path. This makes the trajectory feel predetermined and removes some of the excitement.

Instead, reveal the trail progressively as the ball travels through the air. The trail should only become visible behind the ball, giving the impression that the ball is actively drawing its own path.

Additional polish:

- If a fly ball results in an out after contacting the ground, animate the completed trail to transition to red to reinforce the outcome.
- If the ball is a home run, explore a more celebratory treatment. One idea is animating the slice gradient so that it travels along the trail, but feel free to propose a stronger effect if you have one that better matches the overall presentation.

## Spray Chart

The large visualizer has already communicated the ball's flight, so the spray chart doesn't need to replay that animation.

Instead, have completed trails quickly dissolve or fade into the spray chart. The goal is to establish the final spray chart more quickly while still feeling connected to the main visualization.

Either a looping camera animation that give some movement, or strong thransitioned jumps between diffenet looks good will provide a good final view for the card.

## Hit Information

Both the large visualizer and the AB chips should display swing information.

Include:

- Charge
- Slap
- Star

For charge swings:

- If the swing is undercharged (<100%), display the undercharge percentage.
- If the swing is overcharged (>100%), display the overcharge percentage.

Convert all displayed distances to feet.

---

## Visual Cleanup

Remove the upper-right chip displaying:

- Pitch Type
- Pitch Speed

I don't think this information is valuable enough to justify the space it occupies.

---

## Hit Summary

If an at-bat results in a Star Chance being won or lost, include that information in the hit summary.

---

## Stadium Polish

A few rendering improvements:

- Use the muted purple palette for the Wario Palace pitching mound and surrounding sunburst.
- Replace the current home plate with a properly shaped pentagonal home plate oriented correctly.
- Add batter's boxes.
- Use the batter's boxes as a subtle handedness indicator by highlighting the appropriate batter's box based on the hitter's stance.

---

# Bug Investigation

There is a consistent white flash occurring between certain at-bats.

For example, on the provided replay:

- Transition from the second at-bat (a hit)
- To the third at-bat (an out)

The visualizer briefly flashes white for several frames.

Please identify the root cause and fix it without introducing new transition artifacts.

---

# Final Review

Before considering this work complete:

- Review the finished scene as a whole rather than evaluating each feature independently.
- Ensure the overall composition feels balanced and intentional and the spacing between cards is even and balanced.
- Verify that transitions are smooth and that information hierarchy is clear.
- Confirm that optional UI elements naturally collapse or expand without leaving awkward empty space.
- Revisit your implementation after integration and make any final polish adjustments needed so the scene feels cohesive rather than a collection of independent improvements.

The objective is not simply to implement a checklist, but to produce a Character Spotlight scene that feels polished, cinematic, and significantly easier to read while preserving the richness of the information being presented.