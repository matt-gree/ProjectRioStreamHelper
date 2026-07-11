# Character Spotlight Final Refinement

The Character Spotlight package is essentially complete. This is the final refinement pass before release.

As before, create a checklist from this prompt and verify that every item has been addressed before considering the work complete.

---

# Home Run Camera

When a home run collides with the mesh outside the stadium, the camera correctly stops following the ball.

However, it currently continues to pan downward as though it is still tracking where the ball would land.

Instead, once the collision occurs, gracefully settle the camera at the point of impact. The movement should come to a natural stop rather than implying the ball is continuing beyond the stadium.
---

# Short Hit Camera

The short-hit camera treatment still doesn't match the energy of the longer hit cameras.

I'd like these to share the same overall language.

For shorter hits:

- Use a similar camera movement to the long-hit treatment.
- Be more aggressive with the movement than the current implementation.
- Keep a slightly wider framing so the movement remains easy to follow.

The goal is consistency across all batted balls while still allowing deeper hits to feel more dramatic.

---

# Batting Card Polish

The batting statistics card still needs another spacing pass.

Current issues:

- The layout reserves space for OBP and SLG before those statistics appear.
- That reserved space makes the card feel unbalanced early in the replay.
- Four-digit SLG values currently clip.

Please rethink the spacing of the entire card so it feels balanced both before and after OBP/SLG animate into view.

---

# Camera Reset Animation

After a hit concludes, the camera currently resets too abruptly.

Animate the return to the default viewing position rather than snapping back.

The reset should feel like part of the replay sequence instead of a technical reset.

---

# Spray Chart Camera

I'd like to completely rethink the spray chart camera.

The current implementation feels too focused on individual hit clusters and doesn't lend itself well to remaining on screen.

Instead, design this as an idle presentation that could comfortably loop for an extended period.

Goals:

- Very slow, continuous movement.
- Large, gradual camera motion.
- Keep most of the field visible at all times.
- Avoid zooming tightly on clustered landing locations.
- Home plate should remain visible whenever practical.
- The spray chart should feel like a complete overview of the game rather than emphasizing one area of the field.

Think of this as a presentation camera rather than a replay camera.

---

# AB History

After an at-bat concludes and the next at-bat begins, stop the rainbow highlight animation on the previous AB card.

Only the current at-bat should have active visual emphasis.

---

# Team Logo

Increase the size of the background team logo and vertically center it behind the hero render.

Treat it as a background graphic rather than a foreground element.

It should remain recognizable even with the hero render in front of it, reinforcing team identity without competing for attention.

---

# Hit Contact

Just as we label perfect contact, list sour and nice contact on the AB card and in the hit frame. These give improtant context to the user on the hit.

# Final Review

Once these changes are complete, review the scene as a whole one final time.

Ask yourself:

- Does every camera movement feel intentional?
- Does every transition feel smooth?
- Is the visual hierarchy immediately clear?
- Does anything still feel like placeholder behavior rather than a finished broadcast package?

This should be the final polish pass before release.