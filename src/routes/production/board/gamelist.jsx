import { useState, useCallback, useId } from 'react';
import { X, CalendarDays } from 'lucide-react';
import { Stack, Text } from '../../../components/ui/primitives';
import { Badge } from '../../../components/ui/badge';
import { MultiSelect } from '../../../components/ui/multi-select';
import { Label } from '../../../components/ui/label';
import { TableRow, TableCell } from '../../../components/ui/table';
import { cn } from '../../../lib/utils';
import ParticipantPicker from '../../../components/ParticipantPicker';
import { NumberField } from '../kit';

// What both playback modes share: the Rio game accessors, the game table, and
// the search filter (./games is the surface that composes them).

// ─── game shape helpers ─────────────────────────────────────────────────────
// Live (ongoing) and completed games come back from different Rio endpoints with
// different field names for the same four facts, and a start.gg-shaped entrant
// list turns up in a third. One accessor each, so no table row has to know.

const gameAway = (g) => g.away_user ?? g.away_player ?? g.entrants?.[0]?.[0]?.rioName ?? '';

const gameHome = (g) => g.home_user ?? g.home_player ?? g.entrants?.[1]?.[0]?.rioName ?? '';

const gameAwayScore = (g) => g.away_score ?? g.team1score ?? 0;

const gameHomeScore = (g) => g.home_score ?? g.team2score ?? 0;

const gameMode = (g) => (Array.isArray(g.tags) ? g.tags.join(', ') : (g.tags ?? g.game_mode_name ?? g.game_mode ?? ''));

export const gameLabel = (g) => `${gameAway(g) || '?'} vs ${gameHome(g) || '?'}`;

export const formatTimestamp = (ts) => {
    if (!ts) return '';
    try {
        return new Date(ts).toLocaleString(undefined, {
            month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
        });
    } catch { return String(ts); }
};

/*
 * RIO'S OWN CAP, WRITTEN DOWN, because a search that does not name one still
 * gets it. The Limit field read `All` as its placeholder and sent nothing when
 * empty — so the one state the field described as unlimited was the state that
 * quietly returned the newest 50, and a producer widening a pool by clearing the
 * limit narrowed it back to the default without being told. The field is filled
 * in with 50 now: the number is the truth either way, and a number a producer
 * can see is a number they can change.
 */
export const DEFAULT_LIMIT = 50;

/*
 * THE GAME PICKER NEVER FETCHES ON A TIMER. Both tabs used to re-query the Rio
 * API every `ongoing_games.poll_interval` seconds while visible, with a
 * "Refreshing in 4s" countdown beside the list — and that put a repeating fetch
 * under a producer who had merely selected a board desk.
 *
 * The countdown also mis-stated where a loaded game's freshness comes from. A
 * board following a live API game is kept current SERVER-side and independently
 * of this panel: OngoingGamePool polls only while a live consumer exists (a
 * single-mode board on a live game, or a running rotation with live scope) and
 * re-applies it through `_reapply_single_live` (server/rio/game_pool.py). The
 * list at the bottom is a BROWSER — what else is being played — and a browser
 * refreshes when you ask it to.
 *
 * So the only automatic fetching left is the one a producer set up deliberately:
 * a rotating pool's "Keep pool current" (`pool.refresh_interval`), which is the
 * rotator's own server-side re-check. Don't reintroduce a client timer here.
 */

// A game table body, shared by the single-game search and the pool list.
export function GameRows({ games, loading, emptyLabel, action, activeId, columns = 5, extraCell }) {
    if (games.length === 0) {
        return (
            <TableRow>
                <TableCell colSpan={columns}>
                    <Text size="xs" dimmed ta="center" className="py-4">
                        {loading ? 'Searching…' : emptyLabel}
                    </Text>
                </TableCell>
            </TableRow>
        );
    }
    return games.map((game, i) => {
        const isActive = activeId != null && game.game_id === activeId;
        return (
            <TableRow key={game.game_id} className={cn(isActive && 'bg-[#14b8a6]/15')}>
                <TableCell><Text size="xs" fw={500}>{gameAway(game)}</Text></TableCell>
                <TableCell className="text-center">
                    <Text size="xs" fw={600} className="tabular-nums">
                        {gameAwayScore(game)}–{gameHomeScore(game)}
                    </Text>
                </TableCell>
                <TableCell><Text size="xs" fw={500}>{gameHome(game)}</Text></TableCell>
                <TableCell><Text size="xs" dimmed>{gameMode(game)}</Text></TableCell>
                {extraCell?.(game, i)}
                <TableCell className="w-[92px] text-right">{action(game, isActive, i)}</TableCell>
            </TableRow>
        );
    });
}

/*
 * A chip list of names with an Address Book-suggesting picker, rendered so the
 * chips sit *inside* the control — matching MultiSelect, so adding a name never
 * shoves the surrounding fields around.
 */
function NameChips({ values, onChange, placeholder }) {
    const add = useCallback((name) => {
        const n = (name || '').trim();
        if (!n || values.includes(n)) return;
        onChange([...values, n]);
    }, [values, onChange]);
    const remove = useCallback((name) => onChange(values.filter(v => v !== name)), [values, onChange]);

    return (
        <div className="flex min-h-8 w-full flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-1.5 py-1">
            {values.map(v => (
                <Badge key={v} variant="secondary" className="gap-1 text-[10px]">
                    {v}
                    {/* span wrapper: Badge disables pointer events on direct svgs */}
                    <span role="button" aria-label={`Remove ${v}`} className="inline-flex cursor-pointer" onClick={() => remove(v)}>
                        <X className="size-3" />
                    </span>
                </Badge>
            ))}
            <div className="min-w-[100px] flex-1">
                <ParticipantPicker
                    value=""
                    placeholder={values.length ? 'Add…' : placeholder}
                    onResolve={(row) => add(row.display?.tag || row.identities?.rioName)}
                    onRawValue={add}
                    className="h-6! border-transparent! bg-transparent! px-1! text-xs"
                />
            </div>
        </div>
    );
}

/*
 * The Rio API dates completed games in Unix *seconds* (RioWeb._process_games
 * parses with unit="s"), so the chip stores seconds. A start date anchors to
 * local midnight; an end date anchors to the last second of that day, so a
 * single day picked as both bounds includes the whole day and round-trips back
 * to the same calendar date in the picker.
 */
const toDateInputValue = (unix) => {
    if (unix == null) return '';
    const d = new Date(unix * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

function DateField({ value, onChange, kind = 'start', label }) {
    const commit = (v) => {
        if (!v) { onChange(null); return; }
        const [y, m, d] = v.split('-').map(Number);
        const dt = kind === 'end'
            ? new Date(y, m - 1, d, 23, 59, 59)
            : new Date(y, m - 1, d, 0, 0, 0);
        onChange(Math.floor(dt.getTime() / 1000));
    };
    return (
        <input
            type="date"
            aria-label={label}
            value={toDateInputValue(value)}
            onChange={(e) => commit(e.target.value)}
            className="h-8 w-[138px] rounded-md border border-input bg-transparent px-2 text-xs text-foreground [color-scheme:dark]"
        />
    );
}

/*
 * The completed-game filter surface, shared by the single-game Completed search
 * and the rotating pool so the two read identically. `value` is a filter dict
 * ({tag, username, vs_username, start_time, end_time, limit_games});
 * `onChange(patch)` merges a partial. Fields combine the way the Rio API does:
 * values within one field OR together, different fields AND. `showRefine=false`
 * hides the completed-only date/limit row (e.g. a live-only pool scope).
 *
 * `columns` is EXPLICIT, not a container query, and that is the point. The three
 * chip fields are peers (one AND-ed term each) and read well across — but the
 * `@container` here is the PANEL, not the box this component was handed, so a
 * `@4xl:grid-cols-3` gate goes three-across inside a half-width column too and
 * squeezes each field to 155px. The caller knows how wide it is; ask it.
 * `columns={3}` for the full-width single-game search, stacked (the default) in
 * the rotating pool's half column.
 *
 * (Measured, not assumed: at three-across in a 554px column each field was 179px
 * and "Filter by opponent" already overflowed its own placeholder.)
 */
export function GameFilters({ value, onChange, tagOptions, showRefine = true, trailing = null, columns = 1 }) {
    const v = value ?? {};
    const limitId = useId();
    // The date range is opt-in: an always-visible empty date picker reads like
    // an active filter. Collapsed by default; revealed on demand, or already
    // open when a persisted filter carries dates.
    const [dateOpen, setDateOpen] = useState(() => v.start_time != null || v.end_time != null);
    const closeDates = () => {
        setDateOpen(false);
        onChange({ start_time: null, end_time: null });
    };
    return (
        <Stack gap="sm">
            {/* items-start, so a field that grows chips onto a second line does
                not stretch its two neighbours to match. */}
            <div className={cn(
                'grid grid-cols-1 items-start gap-2',
                columns === 3 && '@4xl:grid-cols-3',
            )}>
                {/*
                  * OPEN VOCABULARY, ACTIVE FIRST. The suggestions are the mode
                  * catalogue in two tiers (../gamemodes) — this season's modes at
                  * the top, ended ones under them — because a pool of completed
                  * games is mostly seasons that have finished, and an active-only
                  * list could not even offer last month's. `creatable` is the
                  * other half: this is a SEARCH filter that goes to Project Rio
                  * as a `tag` param, not a setting with a fixed vocabulary, so a
                  * mode the catalogue hasn't caught up with is typed and used.
                  */}
                <MultiSelect
                    placeholder="Game modes"
                    data={tagOptions}
                    value={v.tag ?? []}
                    onChange={(val) => onChange({ tag: val })}
                    creatable
                    searchPlaceholder="Search or type a mode…"
                />
                <NameChips
                    values={v.username ?? []}
                    onChange={(val) => onChange({ username: val })}
                    placeholder="Filter by player"
                />
                <NameChips
                    values={v.vs_username ?? []}
                    onChange={(val) => onChange({ vs_username: val })}
                    placeholder="Filter by opponent"
                />
            </div>
            {/* Inline labels, not micro-caps stacked over each control: a
                stacked label made this a 51px row for two 32px inputs, and a
                date input states its own format anyway (the two carry
                aria-labels, and the dash between them says it is a range). */}
            {showRefine && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <Label className="whitespace-nowrap text-xs" htmlFor={limitId}>Limit</Label>
                    <NumberField
                        id={limitId}
                        ariaLabel="Limit"
                        min={1} max={500}
                        value={v.limit_games ?? DEFAULT_LIMIT}
                        onChange={(val) => onChange({ limit_games: val })}
                        clearable={false}
                        className="w-[76px]"
                    />
                    {dateOpen ? (
                        <>
                            <DateField label="From" value={v.start_time} kind="start" onChange={(t) => onChange({ start_time: t })} />
                            <Text size="xs" span dimmed>–</Text>
                            <DateField label="To" value={v.end_time} kind="end" onChange={(t) => onChange({ end_time: t })} />
                            <button
                                type="button"
                                onClick={closeDates}
                                className="inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-xs text-muted-foreground hover:text-foreground"
                            >
                                <X className="size-3.5" /> Clear dates
                            </button>
                        </>
                    ) : (
                        <button
                            type="button"
                            onClick={() => setDateOpen(true)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-input px-2.5 text-xs text-muted-foreground hover:text-foreground hover:border-ring"
                        >
                            <CalendarDays className="size-3.5" /> Date range
                        </button>
                    )}
                    {trailing}
                </div>
            )}
        </Stack>
    );
}
