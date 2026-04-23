import { useCallback, useState, useMemo } from 'react';
import { Paper, UnstyledButton, Popover, Tooltip } from '@mantine/core';
import { useStateStore } from '../../context/store';
import { ROSTER_SIZE } from '../../data/msb';
import {
    FIELDER_POSITIONS,
    RUNNER_POSITIONS, BATTER_POSITIONS, BASE_POSITIONS,
    BASE_HALF,
} from '../../data/stadiums';

const charIconUrl = (name) => `/game_assets/msb/characterIcons/${encodeURIComponent(name)}.png`;

/* ------------------------------------------------------------------ */
/*  SVG coordinate helpers                                            */
/* ------------------------------------------------------------------ */

const PAD = 8;

// Fixed infield-focused bounds — outfield is cropped for a utility-first layout.
// Keeps the full infield diamond visible with room for pulled-in outfielders.
const INFIELD_BOUNDS = {
    xMin: -30 - PAD,
    xMax:  30 + PAD,
    zMin: -16,
    zMax:  52 + PAD,
};

// Display-only positions — adjusted for the compact infield-focused layout.
// Actual game positions stay in stadiums.js.
const DISPLAY_FIELDER_POSITIONS = {
    ...FIELDER_POSITIONS,
    C: [0, -8],      
    '1B': [20, 30],      
    '3B': [-20, 30],
    '2B': [10, 39],
    SS: [-10, 39],
    LF: [-24, 48],
    CF: [0,   54],      
    RF: [24,  48],
};

// Display-only runner positions — pushed further out from the bases
const DISPLAY_RUNNER_POSITIONS = {
    '1st': [19.4, 19.4],
    '2nd': [0, 38.8],
    '3rd': [-19.4, 19.4],
};

// Convert game coords [x, z] → SVG coords [sx, sy]
function toSvg(x, z, bounds) {
    return [x, bounds.zMax - z];
}

/* ------------------------------------------------------------------ */
/*  Infield dirt — extended diamond beyond the base paths             */
/* ------------------------------------------------------------------ */

function infieldDirtPoints(bounds) {
    // The dirt diamond extends beyond the base paths. We scale from center
    // of the base diamond (midpoint of 2B and home) outward by ~1.35x,
    // plus extra padding on the home-plate side for the batter area.
    const cx = 0;
    const cz = 19.4; // vertical center of the diamond
    const scale = 1.4;
    const bases = [
        BASE_POSITIONS.home,
        BASE_POSITIONS.first,
        BASE_POSITIONS.second,
        BASE_POSITIONS.third,
    ];
    // Scale each base position from the diamond center, then add a
    // curved dirt cutout near home plate.
    const pts = bases.map(([bx, bz]) => {
        const dx = (bx - cx) * scale;
        const dz = (bz - cz) * scale;
        return toSvg(cx + dx, cz + dz, bounds);
    });
    return pts.map(([sx, sy]) => `${sx},${sy}`).join(' ');
}

/* ------------------------------------------------------------------ */
/*  Roster hook                                                       */
/* ------------------------------------------------------------------ */

function useRosterOptions(scoreboardNumber, teamNumber) {
    const roster = useStateStore(
        s => s?.score?.[scoreboardNumber]?.player?.[teamNumber]?.character
    );
    return useMemo(() => {
        const counts = {};
        const seen = new Set();
        const opts = [];
        for (let i = 0; i < ROSTER_SIZE; i++) {
            const name = roster?.[i]?.name;
            if (name) {
                counts[name] = (counts[name] || 0) + 1;
                if (!seen.has(name)) {
                    seen.add(name);
                    opts.push({ value: name, label: name });
                }
            }
        }
        return { opts, counts };
    }, [roster]);
}

/* ------------------------------------------------------------------ */
/*  PositionCircle                                                    */
/* ------------------------------------------------------------------ */

const CIRCLE_R = 3.5;
const CIRCLE_R_SMALL = 2.8;

function PositionCircle({ cx, cy, r, label, charName, rosterOptions, onSelect, onClear, strokeColor, fillColor, labelAbove }) {
    const [opened, setOpened] = useState(false);
    const occupied = !!charName;

    return (
        <Popover opened={opened} onChange={setOpened} position="right" withArrow width={180} trapFocus>
            <Popover.Target>
                <g
                    style={{ cursor: 'pointer' }}
                    onClick={() => setOpened(o => !o)}
                >
                    <circle
                        cx={cx} cy={cy} r={r}
                        fill={occupied ? fillColor : 'rgba(30,30,30,0.35)'}
                        stroke={occupied ? strokeColor : 'rgba(255,255,255,0.4)'}
                        strokeWidth={0.5}
                    />
                    {occupied && (
                        <>
                            <defs>
                                <clipPath id={`clip-${label}`}>
                                    <circle cx={cx} cy={cy} r={r - 0.3} />
                                </clipPath>
                            </defs>
                            <image
                                href={charIconUrl(charName)}
                                x={cx - r + 0.3}
                                y={cy - r + 0.3}
                                width={(r - 0.3) * 2}
                                height={(r - 0.3) * 2}
                                clipPath={`url(#clip-${label})`}
                                preserveAspectRatio="xMidYMid slice"
                            />
                        </>
                    )}
                    <text
                        x={cx}
                        y={labelAbove ? cy - r - 1.2 : cy + r + 2.5}
                        textAnchor="middle"
                        fontSize={2.5}
                        fontWeight={700}
                        fill="rgba(255,255,255,0.7)"
                    >
                        {label}
                    </text>
                </g>
            </Popover.Target>
            <Popover.Dropdown p={6}>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(5, 1fr)',
                    gap: 3,
                    justifyItems: 'center',
                }}>
                    {rosterOptions.map(opt => (
                        <Tooltip key={opt.value} label={opt.label} withArrow position="top">
                            <UnstyledButton
                                onClick={() => { onSelect(opt.value); setOpened(false); }}
                                style={{
                                    padding: 2,
                                    borderRadius: 4,
                                    border: charName === opt.value
                                        ? '2px solid var(--mantine-color-yellow-5)'
                                        : '2px solid transparent',
                                }}
                            >
                                <img
                                    src={charIconUrl(opt.value)}
                                    alt={opt.label}
                                    width={22}
                                    height={22}
                                    style={{ objectFit: 'contain', display: 'block' }}
                                />
                            </UnstyledButton>
                        </Tooltip>
                    ))}
                    {occupied && (
                        <UnstyledButton
                            onClick={() => { onClear(); setOpened(false); }}
                            style={{
                                padding: 2, borderRadius: 4,
                                border: '2px solid transparent',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                width: 26, height: 26,
                                color: 'var(--mantine-color-red-6)',
                                fontSize: 14, fontWeight: 700,
                            }}
                            title="Clear position"
                        >
                            ✕
                        </UnstyledButton>
                    )}
                </div>
            </Popover.Dropdown>
        </Popover>
    );
}

/* ------------------------------------------------------------------ */
/*  DiamondPanel                                                      */
/* ------------------------------------------------------------------ */

export default function DiamondPanel({ scoreboardNumber = 1 }) {
    const base = `score.${scoreboardNumber}`;
    const setItems = useStateStore(s => s.setItems);

    const homeTeam   = useStateStore(s => Number(s?.score?.[scoreboardNumber]?.home_team ?? 2));
    const halfInning = useStateStore(s => s?.score?.[scoreboardNumber]?.half_inning ?? 'Top');

    const awayTeam     = homeTeam === 2 ? 1 : 2;
    const battingTeam  = halfInning === 'Top' ? awayTeam : homeTeam;
    const fieldingTeam = halfInning === 'Top' ? homeTeam : awayTeam;

    const { opts: batterOptions,  counts: batterCounts  } = useRosterOptions(scoreboardNumber, battingTeam);
    const { opts: fielderOptions, counts: fielderCounts } = useRosterOptions(scoreboardNumber, fieldingTeam);

    // --- state subscriptions ---
    const pitcher     = useStateStore(s => s?.score?.[scoreboardNumber]?.pitcher      ?? '');
    const fieldC      = useStateStore(s => s?.score?.[scoreboardNumber]?.field?.C     ?? '');
    const field1B     = useStateStore(s => s?.score?.[scoreboardNumber]?.field?.['1B'] ?? '');
    const field2B     = useStateStore(s => s?.score?.[scoreboardNumber]?.field?.['2B'] ?? '');
    const field3B     = useStateStore(s => s?.score?.[scoreboardNumber]?.field?.['3B'] ?? '');
    const fieldSS     = useStateStore(s => s?.score?.[scoreboardNumber]?.field?.SS    ?? '');
    const fieldLF     = useStateStore(s => s?.score?.[scoreboardNumber]?.field?.LF    ?? '');
    const fieldCF     = useStateStore(s => s?.score?.[scoreboardNumber]?.field?.CF    ?? '');
    const fieldRF     = useStateStore(s => s?.score?.[scoreboardNumber]?.field?.RF    ?? '');
    const batter      = useStateStore(s => s?.score?.[scoreboardNumber]?.batter       ?? '');
    const batterSide  = useStateStore(s => s?.score?.[scoreboardNumber]?.batterSide   ?? 'right');
    const runner1Name = useStateStore(s => s?.score?.[scoreboardNumber]?.runner1Name  ?? '');
    const runner2Name = useStateStore(s => s?.score?.[scoreboardNumber]?.runner2Name  ?? '');
    const runner3Name = useStateStore(s => s?.score?.[scoreboardNumber]?.runner3Name  ?? '');

    const allPositions = useMemo(() => ({
        pitcher,
        'field.C': fieldC, 'field.1B': field1B, 'field.2B': field2B,
        'field.3B': field3B, 'field.SS': fieldSS, 'field.LF': fieldLF,
        'field.CF': fieldCF, 'field.RF': fieldRF,
        batter, runner1Name, runner2Name, runner3Name,
    }), [pitcher, fieldC, field1B, field2B, field3B, fieldSS, fieldLF, fieldCF, fieldRF,
         batter, runner1Name, runner2Name, runner3Name]);

    // Fielder positions belong to the fielding team; runner/batter positions to the batting team.
    // Deduplication (move-from-previous) is scoped to same-team positions only, and skipped
    // entirely when the character appears more than once on that team's roster.
    const FIELDER_KEYS = useMemo(() => new Set([
        'pitcher', 'field.C', 'field.1B', 'field.2B', 'field.3B', 'field.SS', 'field.LF', 'field.CF', 'field.RF',
    ]), []);
    const BATTER_KEYS = useMemo(() => new Set(['batter', 'runner1Name', 'runner2Name', 'runner3Name']), []);

    const assign = useCallback((stateKey, charName) => {
        const updates = [{ key: `${base}.${stateKey}`, value: charName }];
        if (stateKey === 'runner1Name') updates.push({ key: `${base}.cbRioRunnerOn1`, value: !!charName });
        if (stateKey === 'runner2Name') updates.push({ key: `${base}.cbRioRunnerOn2`, value: !!charName });
        if (stateKey === 'runner3Name') updates.push({ key: `${base}.cbRioRunnerOn3`, value: !!charName });
        const isFielder = FIELDER_KEYS.has(stateKey);
        const sameTeamKeys = isFielder ? FIELDER_KEYS : BATTER_KEYS;
        const rosterCount = (isFielder ? fielderCounts : batterCounts)[charName] || 0;
        // Collect existing placements of this character in same-team positions (excluding target)
        const existing = [];
        for (const [key, current] of Object.entries(allPositions)) {
            if (sameTeamKeys.has(key) && current === charName && key !== stateKey) {
                existing.push(key);
            }
        }
        // Clear oldest placements if adding one more would exceed the roster count
        const excess = Math.max(0, existing.length - rosterCount + 1);
        for (let i = 0; i < excess; i++) {
            const key = existing[i];
            updates.push({ key: `${base}.${key}`, value: '' });
            if (key === 'runner1Name') updates.push({ key: `${base}.cbRioRunnerOn1`, value: false });
            if (key === 'runner2Name') updates.push({ key: `${base}.cbRioRunnerOn2`, value: false });
            if (key === 'runner3Name') updates.push({ key: `${base}.cbRioRunnerOn3`, value: false });
        }
        setItems(updates);
    }, [base, allPositions, setItems, FIELDER_KEYS, BATTER_KEYS, fielderCounts, batterCounts]);

    const assignBatter = useCallback((side, charName) => {
        const updates = [
            { key: `${base}.batter`, value: charName },
            { key: `${base}.batterSide`, value: side },
        ];
        const rosterCount = batterCounts[charName] || 0;
        const existing = [];
        for (const [key, current] of Object.entries(allPositions)) {
            if (BATTER_KEYS.has(key) && current === charName && key !== 'batter') {
                existing.push(key);
            }
        }
        const excess = Math.max(0, existing.length - rosterCount + 1);
        for (let i = 0; i < excess; i++) {
            const key = existing[i];
            updates.push({ key: `${base}.${key}`, value: '' });
            if (key === 'runner1Name') updates.push({ key: `${base}.cbRioRunnerOn1`, value: false });
            if (key === 'runner2Name') updates.push({ key: `${base}.cbRioRunnerOn2`, value: false });
            if (key === 'runner3Name') updates.push({ key: `${base}.cbRioRunnerOn3`, value: false });
        }
        setItems(updates);
    }, [base, allPositions, setItems, BATTER_KEYS, batterCounts]);

    const clear = useCallback((stateKey) => {
        const updates = [{ key: `${base}.${stateKey}`, value: '' }];
        if (stateKey === 'runner1Name') updates.push({ key: `${base}.cbRioRunnerOn1`, value: false });
        if (stateKey === 'runner2Name') updates.push({ key: `${base}.cbRioRunnerOn2`, value: false });
        if (stateKey === 'runner3Name') updates.push({ key: `${base}.cbRioRunnerOn3`, value: false });
        setItems(updates);
    }, [base, setItems]);

    // --- SVG geometry ---
    const bounds = INFIELD_BOUNDS;
    const vbWidth = bounds.xMax - bounds.xMin;
    const vbHeight = bounds.zMax - bounds.zMin;

    // Foul lines — shortened to fit the compact infield view
    const foulLen = 55;
    const foulDx = foulLen * Math.cos(Math.PI / 4);
    const foulDz = foulLen * Math.sin(Math.PI / 4);

    // Base diamond path
    const basePath = [
        BASE_POSITIONS.home,
        BASE_POSITIONS.first,
        BASE_POSITIONS.second,
        BASE_POSITIONS.third,
    ].map(([x, z]) => toSvg(x, z, bounds)).map(([sx, sy]) => `${sx},${sy}`).join(' ');

    // Enlarged base size for display
    const baseSize = BASE_HALF;

    // Fielder positions
    const fielders = [
        { key: 'pitcher',  label: 'P',  pos: DISPLAY_FIELDER_POSITIONS.P,    char: pitcher,  opts: fielderOptions },
        { key: 'field.C',  label: 'C',  pos: DISPLAY_FIELDER_POSITIONS.C,    char: fieldC,   opts: fielderOptions },
        { key: 'field.1B', label: '1B', pos: DISPLAY_FIELDER_POSITIONS['1B'], char: field1B,  opts: fielderOptions },
        { key: 'field.2B', label: '2B', pos: DISPLAY_FIELDER_POSITIONS['2B'], char: field2B,  opts: fielderOptions },
        { key: 'field.3B', label: '3B', pos: DISPLAY_FIELDER_POSITIONS['3B'], char: field3B,  opts: fielderOptions },
        { key: 'field.SS', label: 'SS', pos: DISPLAY_FIELDER_POSITIONS.SS,   char: fieldSS,  opts: fielderOptions },
        { key: 'field.LF', label: 'LF', pos: DISPLAY_FIELDER_POSITIONS.LF,   char: fieldLF,  opts: fielderOptions },
        { key: 'field.CF', label: 'CF', pos: DISPLAY_FIELDER_POSITIONS.CF,   char: fieldCF,  opts: fielderOptions },
        { key: 'field.RF', label: 'RF', pos: DISPLAY_FIELDER_POSITIONS.RF,   char: fieldRF,  opts: fielderOptions },
    ];

    const runners = [
        { key: 'runner1Name', label: '1st', pos: DISPLAY_RUNNER_POSITIONS['1st'], char: runner1Name, opts: batterOptions },
        { key: 'runner2Name', label: '2nd', pos: DISPLAY_RUNNER_POSITIONS['2nd'], char: runner2Name, opts: batterOptions },
        { key: 'runner3Name', label: '3rd', pos: DISPLAY_RUNNER_POSITIONS['3rd'], char: runner3Name, opts: batterOptions },
    ];

    // Batter shows at whichever side is active; the other side is an empty clickable spot
    const activeBatterPos = BATTER_POSITIONS[batterSide] ?? BATTER_POSITIONS.right;
    const inactiveSide = batterSide === 'left' ? 'right' : 'left';
    const inactiveBatterPos = BATTER_POSITIONS[inactiveSide];

    return (
        <Paper withBorder p={4} style={{ width: '100%' }}>
            <svg
                viewBox={`${bounds.xMin} 0 ${vbWidth} ${vbHeight}`}
                width="100%"
                style={{ display: 'block', borderRadius: 4, backgroundColor: '#2d5a2d' }}
                xmlns="http://www.w3.org/2000/svg"
            >
                {/* Foul lines */}
                {(() => {
                    const [ox, oy] = toSvg(0, 0, bounds);
                    const [rx, ry] = toSvg(foulDx, foulDz, bounds);
                    const [lx, ly] = toSvg(-foulDx, foulDz, bounds);
                    return (
                        <>
                            <line x1={ox} y1={oy} x2={rx} y2={ry} stroke="rgba(255,255,255,0.35)" strokeWidth={0.4} />
                            <line x1={ox} y1={oy} x2={lx} y2={ly} stroke="rgba(255,255,255,0.35)" strokeWidth={0.4} />
                        </>
                    );
                })()}

                {/* Infield dirt — larger diamond area */}
                <polygon
                    points={infieldDirtPoints(bounds)}
                    fill="rgba(139,90,43,0.25)"
                    stroke="none"
                />

                {/* Base paths (diamond lines) */}
                <polygon
                    points={basePath}
                    fill="none"
                    stroke="rgba(255,255,255,0.2)"
                    strokeWidth={0.3}
                />

                {/* Pitcher's mound — enlarged */}
                {(() => {
                    const [mx, my] = toSvg(...FIELDER_POSITIONS.P, bounds);
                    return (
                        <circle
                            cx={mx} cy={my} r={3.5}
                            fill="rgba(139,90,43,0.4)"
                            stroke="rgba(255,255,255,0.15)"
                            strokeWidth={0.3}
                        />
                    );
                })()}

                {/* Base markers — enlarged rotated squares */}
                {[BASE_POSITIONS.first, BASE_POSITIONS.second, BASE_POSITIONS.third].map(([x, z], i) => {
                    const [sx, sy] = toSvg(x, z, bounds);
                    return (
                        <rect
                            key={i}
                            x={sx - baseSize}
                            y={sy - baseSize}
                            width={baseSize * 2}
                            height={baseSize * 2}
                            fill="white"
                            transform={`rotate(45 ${sx} ${sy})`}
                        />
                    );
                })}

                {/* Home plate — same size as bases, bottom corners cut at 45° to a point */}
                {(() => {
                    const [hx, hy] = toSvg(...BASE_POSITIONS.home, bounds);
                    const s = baseSize; // same half-size as the other bases
                    // Square top half, then the bottom two corners meet at a 45° point
                    return (
                        <polygon
                            points={[
                                `${hx - s},${hy - s}`,   // top-left
                                `${hx + s},${hy - s}`,   // top-right
                                `${hx + s},${hy}`,       // mid-right (where 45° cut starts)
                                `${hx},${hy + s}`,       // bottom point
                                `${hx - s},${hy}`,       // mid-left (where 45° cut starts)
                            ].join(' ')}
                            fill="white"
                        />
                    );
                })()}

                {/* Batter's boxes */}
                {(() => {
                    const boxW = 4.0;  // half-width in game coords
                    const boxH = 6.5;  // half-height in game coords
                    return ['left', 'right'].map(side => {
                        const [bx, bz] = BATTER_POSITIONS[side];
                        const [sx, sy] = toSvg(bx, bz, bounds);
                        return (
                            <rect
                                key={side}
                                x={sx - boxW}
                                y={sy - boxH}
                                width={boxW * 2}
                                height={boxH * 2}
                                fill="none"
                                stroke="rgba(255,255,255,0.25)"
                                strokeWidth={0.3}
                                strokeDasharray="1.5,1"
                            />
                        );
                    });
                })()}

                {/* Fielder circles */}
                {fielders.map(({ key, label, pos, char, opts }) => {
                    const [sx, sy] = toSvg(pos[0], pos[1], bounds);
                    return (
                        <PositionCircle
                            key={key}
                            cx={sx} cy={sy} r={CIRCLE_R}
                            label={label}
                            charName={char}
                            rosterOptions={opts}
                            onSelect={(c) => assign(key, c)}
                            onClear={() => clear(key)}
                            strokeColor="#20c997"
                            fillColor="rgba(32,201,151,0.3)"
                        />
                    );
                })}

                {/* Runner circles */}
                {runners.map(({ key, label, pos, char, opts }) => {
                    const [sx, sy] = toSvg(pos[0], pos[1], bounds);
                    return (
                        <PositionCircle
                            key={key}
                            cx={sx} cy={sy} r={CIRCLE_R_SMALL}
                            label={label}
                            charName={char}
                            rosterOptions={opts}
                            onSelect={(c) => assign(key, c)}
                            onClear={() => clear(key)}
                            strokeColor="#fab005"
                            fillColor="rgba(250,176,5,0.3)"
                        />
                    );
                })}

                {/* Active batter circle (shows the current batter) */}
                {(() => {
                    const [sx, sy] = toSvg(activeBatterPos[0], activeBatterPos[1], bounds);
                    return (
                        <PositionCircle
                            cx={sx} cy={sy} r={CIRCLE_R_SMALL}
                            label="Bat"
                            charName={batter}
                            rosterOptions={batterOptions}
                            onSelect={(c) => assignBatter(batterSide, c)}
                            onClear={() => clear('batter')}
                            strokeColor="#339af0"
                            fillColor="rgba(51,154,240,0.3)"
                        />
                    );
                })()}

                {/* Inactive batter box circle (click to move batter to opposite side) */}
                {(() => {
                    const [sx, sy] = toSvg(inactiveBatterPos[0], inactiveBatterPos[1], bounds);
                    return (
                        <PositionCircle
                            cx={sx} cy={sy} r={CIRCLE_R_SMALL}
                            label={inactiveSide === 'left' ? 'LHB' : 'RHB'}
                            charName=""
                            rosterOptions={batterOptions}
                            onSelect={(c) => assignBatter(inactiveSide, c)}
                            onClear={() => {}}
                            strokeColor="#339af0"
                            fillColor="rgba(51,154,240,0.15)"
                        />
                    );
                })()}
            </svg>
        </Paper>
    );
}
