import { useCallback, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Stack, Text, Divider } from '../ui/primitives';
import { Panel } from '../ui/panel';
import { NumberInput } from '../ui/number-input';
import { Combobox } from '../ui/combobox';
import { Button } from '../ui/button';
import { SegmentedControl } from '../ui/segmented-control';
import { SimpleTooltip } from '../ui/simple-tooltip';
import { Label } from '../ui/label';
import { useStateStore } from '../../context/store';
import { useAssetUrls } from '../../lib/assets';

import {
    BATTING_RAW_KEYS, PITCHING_RAW_KEYS,
    BATTING_LABELS, PITCHING_LABELS,
    deriveBatting, derivePitching,
    DERIVED_BATTING_LABELS, DERIVED_PITCHING_LABELS,
} from '../../utils/statCalc';

/**
 * Editable stat sheet for a single character, shown in place of the roster.
 */
function StarIcon({ active, superstarUrl }) {
    if (active) {
        return <img src={superstarUrl} alt="Superstar" width={14} height={14} style={{ objectFit: 'contain', display: 'block', filter: 'drop-shadow(0 0 3px rgba(245,159,0,0.8))' }} />;
    }
    return (
        <svg viewBox="0 0 20 20" width="12" height="12" xmlns="http://www.w3.org/2000/svg">
            <polygon
                points="10,1 12.9,7 19.5,7.6 14.5,12 16.2,18.5 10,15 3.8,18.5 5.5,12 0.5,7.6 7.1,7"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.2}
                strokeLinejoin="round"
            />
        </svg>
    );
}

export default function CharacterStatEditor({
    scoreboardNumber = 1, teamNumber, charIndex, charName, onBack,
    characterOptions, onCharacterChange, isCaptain, onSetCaptain,
    isSuperstar, onToggleSuperstar,
    sourceType = 'manual',
}) {
    const prefix = `score.${scoreboardNumber}.stats.${teamNumber}.character.${charIndex}`;
    const setItem = useStateStore(s => s.setItem);
    const [scope, setScope] = useState('web');

    const urls = useAssetUrls();
    const charIconUrl = urls.charIcon;
    const superstarUrl = urls.gameIcon('superstar.png');
    // Carry each character's icon into the selector + dropdown.
    const charOptionsWithIcons = useMemo(
        () => (characterOptions ?? []).map(o => ({ ...o, image: charIconUrl(o.value) })),
        [characterOptions, charIconUrl]
    );

    // State path depends on which scope is active
    const statPath = scope === 'web' ? 'api' : 'current_game';
    const isReadOnly = scope === 'local' && sourceType !== 'manual';

    const charStats = useStateStore(
        s => s?.score?.[scoreboardNumber]?.stats?.[teamNumber]?.character?.[charIndex]
    );

    const batting = (scope === 'web' ? charStats?.api?.batting : charStats?.current_game?.batting) ?? {};
    const pitching = (scope === 'web' ? charStats?.api?.pitching : charStats?.current_game?.pitching) ?? {};

    const setBatting = useCallback((key, val) => {
        setItem(`${prefix}.${statPath}.batting.${key}`, val === '' ? 0 : Number(val));
    }, [prefix, statPath, setItem]);

    const setPitching = useCallback((key, val) => {
        setItem(`${prefix}.${statPath}.pitching.${key}`, val === '' ? 0 : Number(val));
    }, [prefix, statPath, setItem]);

    const derivedBatting = useMemo(() => deriveBatting(batting), [batting]);
    const derivedPitching = useMemo(() => derivePitching(pitching), [pitching]);

    return (
        <Stack gap="xs" className="mt-3">
            {/* Header with back button, slot indicator + character selector */}
            <div className="flex items-center gap-2">
                <Button variant="ghost" size="icon-sm" onClick={onBack} title="Back to roster">
                    <ArrowLeft size={14} />
                </Button>
                <Text size="xs" dimmed fw={600}>#{charIndex + 1}</Text>
                {characterOptions && onCharacterChange ? (
                    <div className="flex-1">
                        <Combobox
                            data={charOptionsWithIcons}
                            value={charName || null}
                            onChange={onCharacterChange}
                            placeholder={`Slot ${charIndex + 1}`}
                            clearable
                        />
                    </div>
                ) : (
                    <Text size="sm" fw={700}>{charName || `Slot ${charIndex + 1}`}</Text>
                )}
                {onToggleSuperstar && (
                    <SimpleTooltip label={isSuperstar ? 'Superstar' : 'Set superstar'} side="right">
                        <button
                            type="button"
                            onClick={onToggleSuperstar}
                            className="flex size-[22px] items-center justify-center rounded-[4px] border transition-colors"
                            style={{ color: isSuperstar ? '#f59f00' : 'var(--color-muted-foreground)' }}
                        >
                            <StarIcon active={isSuperstar} superstarUrl={superstarUrl} />
                        </button>
                    </SimpleTooltip>
                )}
                {onSetCaptain && (
                    <SimpleTooltip label={isCaptain ? 'Captain' : 'Set captain'} side="right">
                        <button
                            type="button"
                            onClick={onSetCaptain}
                            className="flex size-[22px] items-center justify-center rounded-[4px] border text-[11px] font-bold transition-colors"
                            style={{
                                backgroundColor: isCaptain ? '#f5bb00' : undefined,
                                color: isCaptain ? '#0a0a0a' : 'var(--color-muted-foreground)',
                            }}
                        >
                            C
                        </button>
                    </SimpleTooltip>
                )}
            </div>

            {/* Scope toggle */}
            <SegmentedControl
                size="xs"
                value={scope}
                onChange={setScope}
                data={[
                    { value: 'web', label: 'Web' },
                    { value: 'local', label: 'This Game' },
                ]}
            />

            {isReadOnly && (
                <Text size="xs" dimmed className="italic">
                    Read-only during HUD game (stats update automatically)
                </Text>
            )}

            {/* ---- Batting ---- */}
            <Divider label="Batting" />
            <div className="grid grid-cols-6 gap-1">
                {BATTING_RAW_KEYS.map(key => (
                    <div key={key} className="flex flex-col gap-0.5">
                        <Label className="text-[10px] text-muted-foreground">{BATTING_LABELS[key]}</Label>
                        <NumberInput
                            value={batting[key] ?? 0}
                            onChange={val => setBatting(key, val)}
                            min={0}
                            disabled={isReadOnly}
                            className="h-7"
                        />
                    </div>
                ))}
            </div>

            {/* Derived batting (read-only) */}
            <div className="flex flex-wrap gap-2">
                {Object.entries(DERIVED_BATTING_LABELS).map(([key, label]) => (
                    <Panel key={key} glow={false} className="px-1.5 py-0.5">
                        <Text size="xs" dimmed className="leading-none">{label}</Text>
                        <Text size="xs" fw={600} className="leading-tight tabular-nums">{derivedBatting[key]}</Text>
                    </Panel>
                ))}
            </div>

            {/* ---- Pitching ---- */}
            <Divider label="Pitching" />
            <div className="grid grid-cols-6 gap-1">
                {PITCHING_RAW_KEYS.map(key => (
                    <div key={key} className="flex flex-col gap-0.5">
                        <Label className="text-[10px] text-muted-foreground">{PITCHING_LABELS[key]}</Label>
                        <NumberInput
                            value={pitching[key] ?? 0}
                            onChange={val => setPitching(key, val)}
                            min={0}
                            disabled={isReadOnly}
                            className="h-7"
                        />
                    </div>
                ))}
            </div>

            {/* Derived pitching (read-only) */}
            <div className="flex flex-wrap gap-2">
                {Object.entries(DERIVED_PITCHING_LABELS).map(([key, label]) => (
                    <Panel key={key} glow={false} className="px-1.5 py-0.5">
                        <Text size="xs" dimmed className="leading-none">{label}</Text>
                        <Text size="xs" fw={600} className="leading-tight tabular-nums">{derivedPitching[key]}</Text>
                    </Panel>
                ))}
            </div>
        </Stack>
    );
}
