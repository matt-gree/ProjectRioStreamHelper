# Character Spotlight Polish Pass

The first implementation pass is complete. Overall, I'm happy with the direction, especially the larger hero image, the redesigned layout, and the new camera work. This pass should focus on refinement rather than introducing major new features.

Unlike the previous implementation, I want the primary design decisions to be handled by the Fable agent. Fable has shown stronger design judgment and should own the visual polish, layout, typography, spacing, and motion design decisions.

Spin up Sonnet 4.6 agents to handle the smaller implementation tasks, bug fixes, debugging, and isolated engineering work. You should coordinate their work, review the results, and make another design pass once everything has been integrated.

As before, create a checklist from this prompt and keep it updated until every requested item has either been implemented or discussed.

---

# Camera & Visualizer Polish

Overall, I think the new hero camera treatments for home runs and big hits are a significant improvement.

## Ball / Trail Synchronization

There are still several cases where the ball and the rendered trail fall out of sync.

Review the animation timing and ensure the trail always remains perfectly synchronized with the ball throughout the flight.

---

## Ball Trail Thickness

Increase the thickness of all non-home run flight paths to match the home run trail thickness.

The thicker trails are considerably easier to read.

---

## Home Run Camera Limits

If a home run clears the stadium by a significant distance, stop the hero camera once the ball crosses the outfield wall.

Continuing to zoom beyond the stadium causes the camera to clip into the stadium geometry, which breaks the presentation.

---

## Spray Chart Camera

The current end-of-game spray chart camera movement isn't working particularly well.

Sometimes not every hit has appeared before the camera begins moving, and the motion itself can feel somewhat random.

Instead, explore a slower, more deliberate camera movement.

One idea would be a slow orbit back and forth around the stadium that allows the viewer to appreciate the completed spray chart without drawing attention to the camera itself.

---

## Short Hit Camera

The current camera treatment works well for deeper hits, but shallower hits need their own treatment.

I'd like something stylistically similar, but with less zoom and less aggressive movement.

In particular, be careful with camera acceleration.

Right now the faster orbiting combined with the frequent camera resets between consecutive short hits can make the replay difficult to follow.

The camera should support the replay rather than becoming the focus.

The shorter hits should have a bit longer of a pause after the hit lands

---

## Star Hit Trails

Give Star Hits their own visual identity by rendering their ball trail in an animated yellow treatment.

This should immediately communicate that a Star Swing occurred without requiring the viewer to read any UI.

---

## Wario Palace

The Wario Palace color adjustment was implemented incorrectly.

Rather than tinting the existing mound geometry, an entirely new circular design was drawn over the mound.

Remove the added overlay and instead recolor the existing stadium geometry using the intended muted purple palette. There are panels in a zig-zag pattern around teh mound that specifically need to be colored purple. Be careful not to color the panels around the bases the same color, because I think they are linked.

---

# Card Design Review

Overall, I think the redesign is moving in the right direction, but I think some of the design language has drifted away from Slice 26.

## Design Language

There has become a reliance on rounded chip-style labels (examples include "Captain", "Winner", "Star").

These don't really exist elsewhere in Slice 26's visual language.

Please revisit these treatments and bring them back in line with the rest of the interface.

---

## Player Header

The top information card still has a lot of unused space.

I'd like to include:

- Bracket Name
- Bracket Phase
- Bracket Round

Review the typography and increase text sizes where appropriate.

The current layout feels like it could better utilize the available space.

---

## Batting Card

The batting card also feels somewhat sparse.

Review the spacing and typography and increase information density without making the card feel crowded.

---

## Pitching Card

The pitching statistics are currently split across two rows.

I'd like this condensed into a single row.

---

## Defensive Statistics

Include Outs at Position alongside the existing defensive metrics.

Additionally, don't display defensive categories whose value is zero.

The goal is to keep the card compact while highlighting only meaningful contributions.

---

## Game State Card

The lower game-state card needs another spacing pass.

The pitcher information currently hangs too close to the edge of the card.

Please revisit the layout and rebalance the spacing.

---

## Final Score

The final score presentation currently feels somewhat empty and underutilizes the available space.

Explore a stronger end-of-game presentation that better celebrates the conclusion of the replay.

---

## At-Bat Cards

Currently each AB card animates in at full width before shrinking as additional cards appear.

Instead, each card should animate in directly at its final width.

The layout should naturally expand as additional cards are added rather than resizing previously displayed cards.

---

## Hero Image

The hero render looks good.

I'd like the team logo to be:

- Larger
- Better vertically centered

Currently it's almost completely obscured behind the hero render.

It should remain visible enough to reinforce team identity without competing with the featured character.

---

# Debugging

There is one play that currently doesn't animate correctly.

It is classified as an "Out," but appears to actually represent a fielder's choice.

Please investigate why this play isn't generating an animation and determine whether our event classification logic needs to recognize this case separately.

Use the following event for debugging:

```json
bad_render.json
```

---

# Final Polish

Before considering this work complete, I'd like one final design review.

Rather than asking "Was every checklist item implemented?", ask:

- Does the scene feel cohesive?
- Does the typography feel intentional?
- Is the spacing balanced?
- Does every animation feel smooth and motivated?
- Does every camera movement improve readability?
- Does anything still feel visually distracting or inconsistent?

I'd rather have a few fewer features that feel polished than many features that still feel rough around the edges.

This should feel like the final polish pass before release.