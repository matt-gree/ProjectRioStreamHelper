import { useMemberScope } from '../containers/containers';
import { isFedPlacement } from '../sources/placements';
import { sideOfVariant } from '../sources/instances';
import { settingsTypeOf } from '../elements';
import { sideStyleSegment, useSplitSides } from '../../design/sideStyles';

/*
 * Which side's style namespace this panel edits — `{ side, segment }`, where
 * `segment` is `side1`/`side2` under Separate side styles and null otherwise
 * (the shared `overlays.{type}.*`).
 *
 * The side is the SOURCE's: its own `?team=` for a row that owns a source, the
 * container's scope for a member's slot row — the same answer the overlay
 * itself is given, so the panel writes exactly the namespace that source reads.
 */
export function useStyleSide(element, placement) {
    const split = useSplitSides();
    const fed = isFedPlacement({ ...placement, element });
    // Unconditional — a hook may not be skipped. Harmless off a container.
    const scope = useMemberScope(element, placement?.slot ?? null);
    const side = fed ? scope.team : sideOfVariant(placement?.variant);
    return { side, segment: sideStyleSegment(settingsTypeOf(element), side, split) };
}
