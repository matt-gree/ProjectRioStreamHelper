import { memo, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStateStore } from '../../../context/store';
import ParticipantPicker from '../../../components/ParticipantPicker';
import { Text } from '../../../components/ui/primitives';
import { Button } from '../../../components/ui/button';
import { NumberInput } from '../../../components/ui/number-input';
import { cn } from '../../../lib/utils';
import { useAssetUrls } from '../../../lib/assets';
import { ROSTER_SIZE } from '../../../data/msb';
import { ToggleChip } from '../kit';
import { useSideLabels } from '../sides';
import { EYEBROW, FEED_OWNED, num } from './shared';
import { SlotChip } from './subject';

// The mirrored side grid: each side's name, roster and runs, the shared count
// and inning between them, and the layer of the side cascade that seated them.

/*
 * WHY the sides are ordered the way they are.
 *
 * `_decide()` in server/rio/provider.py runs manual > match > pin > back_to_back
 * on every new game and mirrors the deciding layer to `score.{N}.side_reason`
 * "so a surface can say why". Until now the only reference to that key in the
 * whole frontend was the reset that CLEARS it — the answer was computed every
 * game and shown to nobody, which is most of why "how does this work" needed
 * explaining at all.
 */
const SIDE_REASON = {
    manual: {
        label: 'BY HAND',
        title: 'Sides set by hand — your swap outranks the bound match, an Address Book pin and last game until you hand it back',
    },
    match: { label: 'FROM MATCH', title: 'Sides taken from the match bound to this board' },
    pin: { label: 'PINNED', title: 'Sides from a preferred side pinned on a player’s Address Book row' },
    back_to_back: { label: 'LAST GAME', title: 'Sides kept as they were last game' },
};

/*
 * WHICH LAYER SEATED THE SIDES — A STATUS, NOT A SENTENCE ABOUT ONE.
 *
 * It was a sentence one tier under the subject: "Alice on the left — pinned in
 * Settings", later "Alice on side 1 — pinned in the Address Book". Two of its
 * three parts were already drawn larger a few pixels below, in the mirror: which
 * player is on which side is the whole point of that graphic, and repeating it
 * in prose is how a panel gets read as wordy. So it came down to the layer alone,
 * on the region’s own eyebrow — "Sides from the bound match".
 *
 * That is still a sentence, and a sentence is what the eye stops to READ. Every
 * other fact on this rule is a badge (HUD, the mode, the game’s own stage an inch
 * above), so the one item that stays prose is the one that costs the most to scan
 * and says the least — four of its five words are the same on every board. The
 * layer is a state with four values, which is what a chip is for.
 *
 * ITS SUBJECT IS THE BUTTON BESIDE IT. `Swap sides` is the control this badge
 * qualifies and it sits immediately to its right, so a `SIDES` eyebrow in front
 * would put the word twice in four inches — and the rail card spends the same
 * words on the same press (../quickface), so the button keeps its full name
 * rather than the badge borrowing half of it. The full sentence lives in the
 * title, where a producer who has not met the cascade can still find it.
 */
export function sideReasonStatus(reason) {
    return SIDE_REASON[reason] || null;
}

/*
 * THE SIDES, ON THE GAME-STATE EYEBROW — which layer seated them, and the two
 * controls that change it.
 *
 * Sides were spread across three places: a prose line above the mirror naming
 * the layer, a "Swap sides" button at the bottom of the region beside Reset, and
 * nothing at all for getting out of a manual swap. The layer, the flip and the
 * release are one subject, so they read as one row on the rule of the region
 * they govern — and the mirror underneath is what actually SHOWS the result, so
 * nothing here repeats a player name.
 *
 * The override pair is the same idiom as the game mode's (see ModeRow): amber
 * says a hand is on it, and one ghost button hands it back.
 */
export const SidesControl = memo(function SidesControl({ d, reason, transport }) {
    const manual = reason === 'manual';
    const status = sideReasonStatus(reason);
    // Only the HUD feed carries the server-side override, so only a HUD board
    // can be handed back (see releaseSides).
    const releasable = manual && transport === 'hud';
    return (
        <>
            {status && (
                <SlotChip
                    title={status.title}
                    // SlotChip's default palette is an `||` fallback, so a
                    // className has to carry the neutral fill too or the chip
                    // arrives unpainted — twMerge lets the amber win after it.
                    className={cn(
                        'cursor-help bg-secondary text-muted-foreground',
                        // Amber is the console's "a hand is on this", the same
                        // tone the mode override's ring spends — and the one
                        // layer here a producer can be holding open.
                        manual && 'bg-amber-500/15 text-amber-300',
                    )}
                >
                    {status.label}
                </SlotChip>
            )}
            {releasable && (
                <Button
                    size="xs" variant="ghost"
                    className={cn('h-6 shrink-0', d.isStaged('sides_release') && 'text-amber-400')}
                    onClick={d.releaseSides}
                    title="Let the bound match, an Address Book pin or the last game decide"
                >
                    Use auto
                </Button>
            )}
            <Button
                size="xs" variant="outline"
                className={cn('h-6 shrink-0', d.isStaged('swap') && 'border-amber-400/60 text-amber-400')}
                onClick={d.swapSides}
            >
                Swap sides
            </Button>
        </>
    );
});

// The count dots. Clicking the last filled dot clears it, so B/S/O never needs
// a separate decrement.
//
// THE TERMINAL VALUE OF A COUNT IS NEVER DRAWN — three balls, two strikes, two
// outs. A fourth ball is a walk, a third strike and a third out are the end of
// something: each resets the count rather than lighting a dot, so a dot for it
// is a state the board can never be in. The overlay has always been 3/2/2
// (`scoreboard-mount.js`, and the theme SVGs carry only `ball-0..2`,
// `strike-0..1`, `out-0..1`); the desk drew 4/3/3, so a producer correcting a
// count here was offered a value the card could not show.
export const CountDots = memo(function CountDots({ label, count, max, hex, onChange, disabled }) {
    return (
        <div className="flex items-center gap-1">
            <span className="w-3 text-center text-[11px] font-bold leading-none text-muted-foreground">{label}</span>
            {Array.from({ length: max }, (_, i) => {
                const filled = i < count;
                return (
                    <button
                        key={i}
                        type="button"
                        disabled={disabled}
                        aria-label={`${label} ${i + 1}`}
                        onClick={() => onChange(filled && i === count - 1 ? count - 1 : i + 1)}
                        // The dots draw their own colour inline, so there is
                        // nothing to undo here — only the cursor.
                        className="size-3 shrink-0 rounded-full transition-all disabled:cursor-default"
                        style={{
                            backgroundColor: filled ? hex : 'transparent',
                            border: `2px solid ${hex}`,
                            opacity: filled ? 1 : 0.3,
                        }}
                    />
                );
            })}
        </div>
    );
});

/*
 * ONE SIDE'S TEAM — its MSB team and its nine characters.
 *
 * Returned FLAT, all primitives, on purpose. `useShallow` compares element by
 * element, so an object (or an array of objects) would be a fresh identity on
 * every read and this panel would re-render on every unrelated state write. A
 * live HUD board writes 30–100 keys a frame and this desk is open while it does,
 * so a nested shape here is a per-frame cost, not a style question.
 */
export function useSideTeam(sb, team) {
    const flat = useStateStore(useShallow(s => {
        const p = s?.score?.[sb]?.player?.[team];
        const chars = p?.character;
        const out = [p?.msb_team || '', String(num(p?.rio_captainIndex, -1))];
        for (let i = 0; i < ROSTER_SIZE; i++) {
            out.push(chars?.[i]?.name || '', chars?.[i]?.is_starred ? '1' : '');
        }
        return out;
    }));
    return useMemo(() => ({
        msbTeam: flat[0],
        captain: Number(flat[1]),
        roster: Array.from({ length: ROSTER_SIZE }, (_, i) => ({
            name: flat[2 + i * 2],
            starred: flat[3 + i * 2] === '1',
        })),
    }), [flat]);
}

/*
 * The per-character superstar mark. ALWAYS DRAWN on a filled slot, hollow when
 * off — which is the whole point of it: nine hollow stars say "star skills are on
 * and nobody is starred yet", where a cell with no mark at all says nothing. The
 * on state is the game's own superstar art with the amber glow it has always had
 * (`superstar.png` is a required file in the MSB asset pack, so a pack missing it
 * is already reported in Settings rather than silently blank here).
 */
const STAR_POINTS = '10,1 12.9,7 19.5,7.6 14.5,12 16.2,18.5 10,15 3.8,18.5 5.5,12 0.5,7.6 7.1,7';

const StarMark = memo(function StarMark({ on, url }) {
    /*
     * PRSH ships no MSB images (Nintendo IP), so every icon here is a file the
     * user supplied and any of them can be absent. An image tag pointed at a
     * file that isn't there is a torn-page box at whatever size the browser
     * picks — it breaks the grid's rhythm AND reads as a bug rather than as a
     * missing asset. So the art is an enhancement over a vector that already
     * says the same thing: amber and filled for on, hairline for off.
     */
    const [artMissing, setArtMissing] = useState(false);
    if (on && url && !artMissing) {
        return (
            <img
                src={url} alt="Superstar" width={12} height={12} data-star="on"
                onError={() => setArtMissing(true)}
                className="shrink-0 object-contain"
                style={{ filter: 'drop-shadow(0 0 3px rgba(245,159,0,0.8))' }}
            />
        );
    }
    return (
        <svg
            viewBox="0 0 20 20" width={11} height={11} data-star={on ? 'on' : 'off'}
            role={on ? 'img' : undefined} aria-label={on ? 'Superstar' : undefined}
            aria-hidden={on ? undefined : 'true'}
            className={cn('shrink-0', on ? 'text-[#f59f00]' : 'text-muted-foreground/50')}
            style={on ? { filter: 'drop-shadow(0 0 3px rgba(245,159,0,0.6))' } : undefined}
        >
            <polygon
                points={STAR_POINTS}
                fill={on ? 'currentColor' : 'none'}
                stroke="currentColor" strokeWidth={1.6} strokeLinejoin="round"
            />
        </svg>
    );
});

/*
 * The nine characters, as a READOUT.
 *
 * The roster grid that used to live on the Match tab was an editor — a character
 * combobox, a superstar toggle and a captain button per slot — and under every
 * real feed it was read-only anyway, so it was deleted with the rest of the
 * hand-driving controls. What was lost with it is the thing a producer actually
 * used it for: SEEING the lineup, to check the board against the game. That is a
 * subject, not a control, so it comes back as one — captain ringed, superstars
 * starred, nothing clickable.
 *
 * It renders only when the feed has given the side characters. Nine "Slot n"
 * placeholders on an idle board is nine rows of nothing.
 */
const RosterGrid = memo(function RosterGrid({ roster, captain, mirror }) {
    const urls = useAssetUrls();
    const superstar = urls.gameIcon('superstar.png');
    if (!roster.some(r => r.name)) return null;
    return (
        <div className="grid w-full grid-cols-3 gap-1">
            {roster.map((r, i) => {
                const isCaptain = captain === i;
                const icon = r.name ? urls.charIcon(r.name) : undefined;
                return (
                    <div
                        key={i}
                        title={[r.name || `Slot ${i + 1}`, isCaptain && 'captain', r.starred && 'superstar']
                            .filter(Boolean).join(' · ')}
                        className={cn(
                            'flex min-w-0 items-center gap-1 rounded border px-1 py-0.5',
                            mirror && 'flex-row-reverse',
                            isCaptain ? 'border-[#f5bb00]/70' : 'border-border/60',
                        )}
                    >
                        {icon && (
                            <img src={icon} alt="" width={14} height={14} className="shrink-0 object-contain pixelated" />
                        )}
                        <Text
                            size="xs" span truncate
                            className={cn('min-w-0 text-[11px]', isCaptain ? 'text-[#f5bb00]' : 'text-muted-foreground')}
                        >
                            {r.name || '—'}
                        </Text>
                        {/* An empty slot gets no mark — a star on nothing is
                            noise, where a star on a character is a fact. */}
                        {r.name && <StarMark on={r.starred} url={superstar} />}
                    </div>
                );
            })}
        </div>
    );
});

/*
 * ONE SIDE, as a column: who is there · do they bat last · what they're playing
 * as · who's in the lineup. Side 2's column is reversed and right-aligned, so
 * the two read outward from the score between them.
 *
 * The name field IS the identity override — the only identity edit that survives
 * a feed. The raw name comes from Project Rio; the picker shows it, and pinning
 * one here is how a producer corrects a mis-typed or alt online ID without the
 * next frame undoing it. It used to be a separate "Who's on each side" group
 * below the scores, which asked the producer to hold "P1 = the left name" in
 * their head while a mislabelled game was on air.
 *
 * Home is a chip on the side that HAS it, not a Left/Right picker: which side
 * bats last is a fact about a player, and "MattGree bats last" is the sentence a
 * producer is checking against the game. Clicking the other side moves it;
 * clicking the side that already has it does nothing, because this is a choice
 * between two sides and not a toggle that can be off.
 */
export const SidePanel = memo(function SidePanel({ side, d }) {
    const { g } = d;
    const sides = useSideLabels();
    const label = sides.label(side);
    const phrase = sides.phrase(side);
    const team = useSideTeam(d.sb, side);
    const urls = useAssetUrls();
    const mirror = side === 2;
    const feedName = side === 1 ? g.name1 : g.name2;
    const override = side === 1 ? g.override1 : g.override2;
    const isHome = num(d.val('home_team', g.homeTeam), 2) === side;
    const shown = d.val(`override.${side}`, override) || feedName;
    const logo = team.msbTeam ? urls.teamIcon(team.msbTeam) : null;
    return (
        <div className={cn('flex min-w-0 flex-col gap-1.5', mirror && 'items-end')}>
            <span className={cn(EYEBROW, d.isStaged(`override.${side}`) && 'text-amber-400')}>
                {label}
            </span>
            <div className={cn('flex w-full min-w-0 items-center gap-1.5', mirror && 'flex-row-reverse')}>
                <div className="min-w-0 flex-1">
                    <ParticipantPicker
                        value={shown}
                        placeholder="Online ID"
                        onResolve={row => d.setNameOverride(side, row?.identities?.rioName || row?.display?.tag || '')}
                        onRawValue={v => d.setNameOverride(side, v)}
                        className={cn('h-7 text-xs', override && 'border-amber-400 ring-1 ring-amber-400/40')}
                    />
                </div>
                <ToggleChip
                    label="Home"
                    ariaLabel={`${phrase} bats last`}
                    title={isHome
                        ? `${shown || label} bats last`
                        : `Make ${phrase} home`}
                    checked={isHome}
                    staged={d.isStaged('home_team')}
                    onChange={() => { if (!isHome) d.setField('home_team', side); }}
                />
            </div>
            {team.msbTeam && (
                <div className={cn('flex min-w-0 items-center gap-1.5', mirror && 'flex-row-reverse')}>
                    {logo && (
                        <img src={logo} alt="" width={16} height={16} className="shrink-0 object-contain pixelated" />
                    )}
                    <Text size="xs" span truncate dimmed className="min-w-0">{team.msbTeam}</Text>
                </div>
            )}
            <RosterGrid roster={team.roster} captain={team.captain} mirror={mirror} />
        </div>
    );
});

// One side's runs, in the centre block beside the other side's — the pair is how
// a score is read, so they sit together rather than one per side column.
export const ScoreBox = memo(function ScoreBox({ side, d }) {
    const { label } = useSideLabels();
    // `score_left` / `score_right` are the STATE keys and stay as they are —
    // renaming a state key is a migration, and the feed writes them. Only what
    // the box says about itself is vocabulary.
    const field = side === 1 ? 'score_left' : 'score_right';
    const live = side === 1 ? d.g.scoreLeft : d.g.scoreRight;
    return (
        <NumberInput
            aria-label={`Score — ${label(side)}`}
            value={d.val(field, live)}
            onChange={v => d.setField(field, v === '' ? 0 : Number(v))}
            disabled={d.feedLive}
            min={0}
            className={cn(
                'h-9 w-14 px-1 text-center text-xl font-bold tabular-nums', FEED_OWNED,
                d.isStaged(field) && 'border-amber-400/60 text-amber-400',
            )}
        />
    );
});
