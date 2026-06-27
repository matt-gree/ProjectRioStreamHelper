import { useCallback, useEffect, useState, useRef } from 'react';
import { Info, ChevronDown, ChevronUp } from 'lucide-react';
import { Stack, Text, Divider, Loader } from '../ui/primitives';
import { Panel } from '../ui/panel';
import { NumberInput } from '../ui/number-input';
import { TextField } from '../ui/text-field';
import { SimpleSelect } from '../ui/simple-select';
import { Combobox } from '../ui/combobox';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Label } from '../ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { Collapsible, CollapsibleContent } from '../ui/collapsible';
import { cn } from '../../lib/utils';
import { useStateStore, useSettingsStore } from '../../context/store';
import { useSocketSubscribe } from '../../context/socket';
import { HALF_INNINGS } from '../../data/msb';
import { STADIUM_OPTIONS } from '../../data/stadiums';

const halfInningOptions = HALF_INNINGS.map(h => ({ value: h, label: h }));

// Safely coerce a value to number (state may hold strings after socket round-trip)
const num = (v, fallback = 0) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
};

const sourceOptions = [
    { value: 'manual',    label: 'Manual' },
    { value: 'hud',       label: 'HUD' },
    { value: 'live_game', label: 'Live API Game' },
];

// Count-dot colors keyed by the legacy Mantine color name.
const DOT_COLORS = { green: '#22c55e', yellow: '#f5bb00', red: '#e60012' };

function CountDots({ count, max, color, onChange }) {
    const hex = DOT_COLORS[color] ?? '#22c55e';
    return (
        <div className="flex items-center gap-1.5">
            {Array.from({ length: max }, (_, i) => {
                const filled = i < count;
                return (
                    <button
                        key={i}
                        type="button"
                        onClick={() => onChange(filled && i === count - 1 ? count - 1 : i + 1)}
                        className="size-3 shrink-0 rounded-full transition-all"
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
}

/**
 * Central score column: scores, baseball state, match info.
 */
export default function ScoreControls({ scoreboardNumber = 1, onSwapTeams, sourceType = 'manual', onSetSource }) {
    const base = `score.${scoreboardNumber}`;
    const setItem = useStateStore(s => s.setItem);
    const settingsSetItem = useSettingsStore(s => s.setItem);

    // Team scores
    const scoreLeft  = useStateStore(s => num(s?.score?.[scoreboardNumber]?.score_left, 0));
    const scoreRight = useStateStore(s => num(s?.score?.[scoreboardNumber]?.score_right, 0));

    // Baseball state
    const inning      = useStateStore(s => num(s?.score?.[scoreboardNumber]?.inning, 1));
    const halfInning  = useStateStore(s => s?.score?.[scoreboardNumber]?.half_inning ?? 'Top');
    const outs        = useStateStore(s => num(s?.score?.[scoreboardNumber]?.outs, 0));
    const strikes     = useStateStore(s => num(s?.score?.[scoreboardNumber]?.strikes, 0));
    const balls       = useStateStore(s => num(s?.score?.[scoreboardNumber]?.balls, 0));

    // Match info
    const bestOf   = useStateStore(s => {
        const raw = s?.score?.[scoreboardNumber]?.best_of;
        if (typeof raw === 'string') {
            const m = raw.match(/\d+/);
            return m ? Number(m[0]) : 3;
        }
        return num(raw, 3);
    });
    const phase    = useStateStore(s => s?.score?.[scoreboardNumber]?.phase ?? '');
    const match    = useStateStore(s => s?.score?.[scoreboardNumber]?.match ?? '');
    const stadium  = useStateStore(s => s?.score?.[scoreboardNumber]?.stadium ?? '');

    // Game mode is per-scoreboard. No global fallback — empty means "don't
    // fetch stats for this scoreboard until the user picks a mode."
    const statsTag = useSettingsStore(s =>
        s?.scoreboards?.sources?.[scoreboardNumber]?.stats_tag ?? ''
    );
    const [gameModes, setGameModes] = useState([]);
    const [diagOpen, setDiagOpen] = useState(false);
    const [diagnostics, setDiagnostics] = useState(null);
    const [matchOpen, setMatchOpen] = useState(false);
    const [fetchingStats, setFetchingStats] = useState(false);
    const prevTagRef = useRef(statsTag);

    useEffect(() => {
        fetch('/api/v1/rio/game-modes')
            .then(r => r.json())
            .then(data => {
                const opts = Object.entries(data).map(([name]) => ({
                    value: name,
                    label: name,
                }));
                setGameModes(opts);
            })
            .catch(() => {});
    }, []);

    // Push-based diagnostics: server emits v1.stats.fetch_status on every
    // loading→done transition for this scoreboard. No polling, no spinner lag.
    const handleFetchStatus = useCallback((payload) => {
        if (payload?.scoreboard !== scoreboardNumber) return;
        setDiagnostics(payload);
        setFetchingStats(payload.status === 'loading');
    }, [scoreboardNumber]);
    useSocketSubscribe('v1.stats.fetch_status', handleFetchStatus);

    // Auto-fetch stats when game mode changes (skip if blank)
    useEffect(() => {
        if (prevTagRef.current !== statsTag) {
            prevTagRef.current = statsTag;
            if (!statsTag) {
                setDiagnostics(null);
                setFetchingStats(false);
                return;
            }
            setFetchingStats(true);
            // Fire refresh — server pushes status updates via SocketIO.
            fetch(`/api/v1/rio/stats/refresh?scoreboard=${scoreboardNumber}`, { method: 'POST' })
                .catch(() => setFetchingStats(false));
        }
    }, [statsTag, scoreboardNumber]);

    const handleGameModeChange = useCallback((val) => {
        settingsSetItem(`scoreboards.sources.${scoreboardNumber}.stats_tag`, val ?? '');
    }, [settingsSetItem, scoreboardNumber]);

    const handleInspect = useCallback(() => {
        setDiagOpen(true);
        // One-shot read for the case where the user opens the popover without
        // having triggered a fetch this session — without it, diagnostics
        // would show null until the next fetch.
        if (diagnostics == null) {
            fetch(`/api/v1/rio/stats/diagnostics?scoreboard=${scoreboardNumber}`)
                .then(r => r.json())
                .then(d => setDiagnostics(d))
                .catch(() => {});
        }
    }, [scoreboardNumber, diagnostics]);

    const handleRefreshStats = useCallback(() => {
        setFetchingStats(true);
        fetch(`/api/v1/rio/stats/refresh?scoreboard=${scoreboardNumber}`, { method: 'POST' })
            .catch(() => setFetchingStats(false));
    }, [scoreboardNumber]);

    const set = useCallback((field, value) => {
        setItem(`${base}.${field}`, value);
    }, [base, setItem]);

    const clearAtBatState = useCallback(() => {
        setItem(`${base}.cbRioRunnerOn1`, false);
        setItem(`${base}.cbRioRunnerOn2`, false);
        setItem(`${base}.cbRioRunnerOn3`, false);
        setItem(`${base}.runner1Name`, '');
        setItem(`${base}.runner2Name`, '');
        setItem(`${base}.runner3Name`, '');
        setItem(`${base}.batter`, '');
        setItem(`${base}.pitcher`, '');
        for (const pos of ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']) {
            setItem(`${base}.field.${pos}`, '');
        }
    }, [base, setItem]);

    const clearTournamentData = useCallback(() => {
        const tagFields = ['name', 'team', 'full_name', 'country', 'state', 'pronoun'];
        for (const t of [1, 2]) {
            for (const f of tagFields) {
                setItem(`${base}.player.${t}.${f}`, '');
            }
        }
        setItem(`${base}.phase`, '');
        setItem(`${base}.match`, '');
    }, [base, setItem]);

    const resetBaseballState = useCallback(() => {
        setItem(`${base}.score_left`, 0);
        setItem(`${base}.score_right`, 0);
        setItem(`${base}.inning`, 1);
        setItem(`${base}.half_inning`, 'Top');
        setItem(`${base}.outs`, 0);
        setItem(`${base}.strikes`, 0);
        setItem(`${base}.balls`, 0);
        setItem(`${base}.cbRioRunnerOn1`, false);
        setItem(`${base}.cbRioRunnerOn2`, false);
        setItem(`${base}.cbRioRunnerOn3`, false);
        setItem(`${base}.runner1Name`, '');
        setItem(`${base}.runner2Name`, '');
        setItem(`${base}.runner3Name`, '');
        setItem(`${base}.batter`, '');
        setItem(`${base}.pitcher`, '');
        setItem(`${base}.batter_hand`, 0);
        setItem(`${base}.pitcher_hand`, 0);
        setItem(`${base}.batterSide`, 'right');
        setItem(`${base}.batter_roster_index`, -1);
        setItem(`${base}.pitcher_roster_index`, -1);
        setItem(`${base}.star_chance`, false);
        setItem(`${base}.game_completed`, false);
        setItem(`${base}.game_id`, null);
        setItem(`${base}.home_team`, 2);
        setItem(`${base}.innings_selected`, null);
        setItem(`${base}.stadium`, '');
        setItem(`${base}.tag_set`, null);
        setItem(`${base}.away_linescore`, []);
        setItem(`${base}.home_linescore`, []);
        for (const pos of ['P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF']) {
            setItem(`${base}.field.${pos}`, '');
        }
        for (const t of [1, 2]) {
            setItem(`${base}.player.${t}.rioName`, '');
            setItem(`${base}.player.${t}.msb_team`, '');
            setItem(`${base}.player.${t}.rio_captainIndex`, -1);
            setItem(`${base}.player.${t}.logo`, '');
            setItem(`${base}.player.${t}.port`, null);
            setItem(`${base}.player.${t}.team_stars`, 0);
            setItem(`${base}.player.${t}.batting_hands`, []);
            setItem(`${base}.player.${t}.fielding_hands`, []);
            for (let i = 0; i < 9; i++) {
                setItem(`${base}.player.${t}.character.${i}.name`, '');
                setItem(`${base}.player.${t}.character.${i}.is_starred`, false);
                setItem(`${base}.player.${t}.character.${i}.position`, '');
            }
        }
    }, [base, setItem]);

    // Guard NumberInput onChange — it can return '' (empty string)
    const setNum = useCallback((field, val, fallback = 0) => {
        set(field, val === '' ? fallback : Number(val));
    }, [set]);

    return (
        <Panel glow={false} title="Game State">
            <div className="p-3.5">
            <Stack gap="md">
                {/* ---- Data Source ---- */}
                {onSetSource && (
                    <div className="flex flex-col gap-1.5">
                        <Label className="field-label">Data Source</Label>
                        <SimpleSelect
                            data={sourceOptions}
                            value={sourceType}
                            onChange={val => onSetSource(val)}
                        />
                    </div>
                )}

                {/* ---- Game Mode ---- */}
                <div className="flex items-end gap-1.5">
                    <div className="flex flex-1 flex-col gap-1.5">
                        <Label className="field-label">Game Mode</Label>
                        <Combobox
                            placeholder="Select game mode"
                            data={gameModes}
                            value={statsTag || null}
                            onChange={handleGameModeChange}
                            clearable
                        />
                    </div>
                    <Popover open={diagOpen && diagnostics != null} onOpenChange={setDiagOpen}>
                        <PopoverTrigger asChild>
                            <Button variant="ghost" size="icon-sm" onClick={handleInspect} title="Inspect stats fetch">
                                {fetchingStats ? <Loader size={12} /> : <Info size={14} />}
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="w-[320px]">
                            <Stack gap="xs">
                                <Text size="xs" fw={600}>Stats Fetch Diagnostics</Text>
                                {diagnostics?.fetched_at ? (
                                    <>
                                        {diagnostics.error && (
                                            <Text size="xs" c="#ff5a5f">{diagnostics.error}</Text>
                                        )}
                                        {diagnostics.url && (
                                            <div>
                                                <Text size="xs" dimmed>URL Pattern</Text>
                                                <Text size="xs" className="break-all">{diagnostics.url}</Text>
                                            </div>
                                        )}
                                        {diagnostics.tag && (
                                            <div className="flex items-center gap-1">
                                                <Text size="xs" dimmed>Tag:</Text>
                                                <Badge variant="secondary" className="text-[10px]">{diagnostics.tag}</Badge>
                                            </div>
                                        )}
                                        {Object.keys(diagnostics.players).length > 0 && (
                                            <>
                                                <Divider />
                                                {Object.entries(diagnostics.players).map(([name, info]) => (
                                                    <div key={name} className="flex items-center justify-between">
                                                        <Text size="xs">{name}</Text>
                                                        {info.status === 'loading' ? (
                                                            <div className="flex items-center gap-1">
                                                                <Loader size={10} />
                                                                <Text size="xs" dimmed>Loading...</Text>
                                                            </div>
                                                        ) : info.error ? (
                                                            <Badge variant="destructive" className="text-[10px]">Error</Badge>
                                                        ) : (
                                                            <Badge
                                                                className={cn('text-[10px] text-white',
                                                                    info.char_count > 0 ? 'bg-[#22c55e]' : 'bg-[#f5bb00] text-black')}
                                                            >
                                                                {info.char_count} chars
                                                            </Badge>
                                                        )}
                                                    </div>
                                                ))}
                                            </>
                                        )}
                                        <Text size="xs" dimmed ta="right">
                                            {new Date(diagnostics.fetched_at).toLocaleTimeString()}
                                        </Text>
                                    </>
                                ) : (
                                    <Text size="xs" dimmed>No stats have been fetched yet.</Text>
                                )}
                                <Button
                                    size="sm"
                                    variant="secondary"
                                    className="w-full"
                                    onClick={handleRefreshStats}
                                    disabled={fetchingStats}
                                >
                                    {fetchingStats && <Loader size={12} />}
                                    Refresh Stats
                                </Button>
                            </Stack>
                        </PopoverContent>
                    </Popover>
                </div>

                {/* ---- Stadium Selector ---- */}
                <div className="flex flex-col gap-1.5">
                    <Label className="field-label">Stadium</Label>
                    <Combobox
                        placeholder="Select stadium"
                        data={STADIUM_OPTIONS}
                        value={stadium || null}
                        onChange={val => set('stadium', val ?? '')}
                        clearable
                    />
                </div>

                {/* ---- Scores + Inning + Count Dots ---- */}
                <div className="flex items-stretch gap-2">
                    {/* Left: scores + inning stacked */}
                    <Stack gap="xs" className="flex-1">
                        <div className="flex items-end justify-center gap-2">
                            <div className="flex flex-1 flex-col items-center gap-0.5">
                                <span className="label-display text-[10px] text-muted-foreground">P1</span>
                                <NumberInput
                                    value={scoreLeft}
                                    onChange={val => setNum('score_left', val)}
                                    min={0}
                                    className="h-11 text-center text-2xl font-bold tabular-nums"
                                />
                            </div>
                            <div className="flex flex-1 flex-col items-center gap-0.5">
                                <span className="label-display text-[10px] text-muted-foreground">P2</span>
                                <NumberInput
                                    value={scoreRight}
                                    onChange={val => setNum('score_right', val)}
                                    min={0}
                                    className="h-11 text-center text-2xl font-bold tabular-nums"
                                />
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <SimpleSelect
                                data={halfInningOptions}
                                value={halfInning}
                                onChange={val => { set('half_inning', val ?? 'Top'); clearAtBatState(); }}
                                triggerClassName="flex-[4]"
                            />
                            <NumberInput
                                value={inning}
                                onChange={val => setNum('inning', val, 1)}
                                min={1} max={99}
                                className="flex-[2]"
                            />
                        </div>
                    </Stack>

                    {/* Right: B/S/O labeled dots spanning both rows */}
                    <Stack gap="xs" justify="center">
                        {[
                            { label: 'B', count: balls,   max: 4, color: 'green',  field: 'balls' },
                            { label: 'S', count: strikes, max: 3, color: 'yellow', field: 'strikes' },
                            { label: 'O', count: outs,    max: 3, color: 'red',    field: 'outs' },
                        ].map(({ label, count, max, color, field }) => (
                            <div key={field} className="flex items-center gap-1">
                                <span className="w-3 text-center text-[12px] font-bold leading-none text-muted-foreground">{label}</span>
                                <CountDots
                                    count={count}
                                    max={max}
                                    color={color}
                                    onChange={val => setNum(field, val)}
                                />
                            </div>
                        ))}
                    </Stack>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <Button variant="outline" size="sm" onClick={() => { onSwapTeams(); clearAtBatState(); }}>
                        Swap Teams
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => {
                        const t1 = useStateStore.getState()?.score?.[scoreboardNumber]?.player?.[1] ?? {};
                        const t2 = useStateStore.getState()?.score?.[scoreboardNumber]?.player?.[2] ?? {};
                        const fields = ['name', 'team', 'full_name', 'country', 'state', 'pronoun'];
                        for (const f of fields) {
                            setItem(`${base}.player.1.${f}`, t2[f] ?? '');
                            setItem(`${base}.player.2.${f}`, t1[f] ?? '');
                        }
                    }}>
                        Swap Tags
                    </Button>
                </div>
                <Button variant="outline" size="sm" className="w-full border-destructive/40 text-destructive hover:bg-destructive/10" onClick={resetBaseballState}>
                    Reset Game State
                </Button>

                <Divider />

                {/* ---- Match Info ---- */}
                <button type="button" onClick={() => setMatchOpen(o => !o)}>
                    <div className="flex items-center justify-between">
                        <Text size="sm" fw={700}>Bracket Match Info</Text>
                        {matchOpen ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
                    </div>
                </button>
                <Collapsible open={matchOpen}>
                    <CollapsibleContent>
                        <Stack gap="xs">
                            <div className="flex flex-col gap-1.5">
                                <Label className="field-label">Best Of</Label>
                                <NumberInput
                                    value={bestOf}
                                    onChange={val => set('best_of', `Best Of ${val === '' ? 3 : Number(val)}`)}
                                    min={1} max={99} step={2}
                                />
                            </div>
                            <TextField
                                label="Phase"
                                value={phase}
                                onChange={e => set('phase', e.currentTarget.value)}
                            />
                            <TextField
                                label="Match"
                                value={match}
                                onChange={e => set('match', e.currentTarget.value)}
                            />
                            <Button variant="outline" size="sm" className="w-full border-destructive/40 text-destructive hover:bg-destructive/10" onClick={clearTournamentData}>
                                Clear Tags
                            </Button>
                        </Stack>
                    </CollapsibleContent>
                </Collapsible>
            </Stack>
            </div>
        </Panel>
    );
}
