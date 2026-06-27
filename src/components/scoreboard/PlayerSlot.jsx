import { memo, useCallback, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Stack, Text } from '../ui/primitives';
import { TextField } from '../ui/text-field';
import { Combobox } from '../ui/combobox';
import { Collapsible, CollapsibleContent } from '../ui/collapsible';
import { SimpleTooltip } from '../ui/simple-tooltip';
import { useStateStore } from '../../context/store';
import { useAssetUrls } from '../../lib/assets';
import { MSB_CHARACTERS, MSB_TEAMS, ROSTER_SIZE } from '../../data/msb';
import { participantToScoreEntries } from '../../lib/participants';
import ParticipantPicker from '../ParticipantPicker';
import CharacterStatEditor from './CharacterStatEditor';

const characterOptions = MSB_CHARACTERS.map(c => ({ value: c, label: c }));

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

/**
 * A single player slot within a team panel.
 *
 * Props:
 *   scoreboardNumber: number (usually 1)
 *   teamNumber: 1 | 2
 *   playerNumber: 1-based player index
 */
export default memo(function PlayerSlot({ scoreboardNumber = 1, teamNumber, playerNumber, sourceType = 'manual' }) {
    const basePath = `score.${scoreboardNumber}.player.${teamNumber}`;
    const [detailsOpen, setDetailsOpen] = useState(false);
    const [activeCharDetail, setActiveCharDetail] = useState(null);

    const urls = useAssetUrls();
    const charIconUrl = urls.charIcon;
    const teamIconUrl = urls.teamIcon;
    const superstarUrl = urls.gameIcon('superstar.png');
    // Team options carry their logo so the selector + dropdown show sprites.
    const teamOptions = useMemo(
        () => MSB_TEAMS.map(t => ({ value: t, label: t, image: teamIconUrl(t) })),
        [teamIconUrl]
    );

    // Single shallow selector for the whole player object — Zustand's useShallow
    // does a shallow equality check so we only re-render when the player sub-tree
    // actually changes, not on every unrelated state update.
    const player = useStateStore(useShallow(
        s => s?.score?.[scoreboardNumber]?.player?.[teamNumber]
    ));
    const name       = player?.name ?? '';
    const teamPrefix = player?.team ?? '';
    const rioName    = player?.rioName ?? '';
    const msbTeam    = player?.msb_team ?? '';
    const captain    = player?.rio_captainIndex ?? 0;
    const fullName   = player?.full_name ?? '';
    const country    = player?.country ?? '';
    const state      = player?.state ?? '';
    const pronoun    = player?.pronoun ?? '';
    const youtube    = player?.youtube ?? '';
    const twitter    = player?.twitter ?? '';

    const setItem = useStateStore(s => s.setItem);
    const setItems = useStateStore(s => s.setItems);

    const set = useCallback((field, value) => {
        setItem(`${basePath}.${field}`, value);
    }, [basePath, setItem]);

    // Picking a person from the address book copies their enrichment into the
    // player sub-tree in one batch (resolve-by-copy). Picking "use without
    // saving" just sets the raw rioName, preserving the manual escape hatch.
    const resolveParticipant = useCallback((row) => {
        const entries = participantToScoreEntries(row, basePath);
        if (entries.length) setItems(entries);
    }, [basePath, setItems]);

    // Build roster array from character state, memoized to avoid re-creating on every render
    const rosterState = player?.character;
    const roster = useMemo(() => {
        const r = [];
        for (let i = 0; i < ROSTER_SIZE; i++) {
            r.push(rosterState?.[i]?.name ?? '');
        }
        return r;
    }, [rosterState]);

    const rosterStarred = useMemo(() => {
        const s = [];
        for (let i = 0; i < ROSTER_SIZE; i++) {
            s.push(rosterState?.[i]?.is_starred ?? false);
        }
        return s;
    }, [rosterState]);

    const setCharacter = useCallback((index, charName) => {
        setItem(`${basePath}.character.${index}.name`, charName);
    }, [basePath, setItem]);

    const setCaptain = useCallback((index) => {
        set('rio_captainIndex', index);
    }, [set]);

    const toggleSuperstar = useCallback((index) => {
        setItem(`${basePath}.character.${index}.is_starred`, !rosterStarred[index]);
    }, [basePath, setItem, rosterStarred]);

    return (
        <Stack gap="sm">
            {/* Main row: tag + prefix + Rio name */}
            <div className="grid grid-cols-12 items-end gap-2.5">
                <div className="col-span-4">
                    <TextField
                        label={`Player ${playerNumber}`}
                        placeholder="Tag"
                        value={name}
                        onChange={e => set('name', e.currentTarget.value)}
                    />
                </div>
                <div className="col-span-3">
                    <TextField
                        label="Prefix"
                        placeholder="Sponsor"
                        value={teamPrefix}
                        onChange={e => set('team', e.currentTarget.value)}
                    />
                </div>
                <div className="col-span-5">
                    <Stack gap={4}>
                        <Text size="xs" dimmed span>Rio Name</Text>
                        <ParticipantPicker
                            value={rioName}
                            placeholder="Online ID"
                            onResolve={resolveParticipant}
                            onRawValue={(text) => set('rioName', text)}
                            leftSection={<img src="/game_assets/rio_logo.png" alt="Rio" width={16} height={16} style={{ objectFit: 'contain' }} />}
                        />
                    </Stack>
                </div>
            </div>

            {/* Details toggle */}
            <button
                type="button"
                onClick={() => setDetailsOpen(o => !o)}
                className="flex items-center gap-1 self-start text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
                {detailsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                {detailsOpen ? 'Hide details' : 'More details'}
            </button>

            {/* Collapsible detail fields */}
            <Collapsible open={detailsOpen}>
                <CollapsibleContent>
                    <div className="grid grid-cols-12 gap-2">
                        <div className="col-span-4">
                            <TextField label="Full Name" placeholder="First Last" value={fullName} onChange={e => set('full_name', e.currentTarget.value)} />
                        </div>
                        <div className="col-span-2">
                            <TextField label="State" placeholder="NY, CA..." value={state} onChange={e => set('state', e.currentTarget.value)} />
                        </div>
                        <div className="col-span-3">
                            <TextField label="Country" placeholder="US, CA..." value={country} onChange={e => set('country', e.currentTarget.value)} />
                        </div>
                        <div className="col-span-3">
                            <TextField label="Pronoun" placeholder="He/Him" value={pronoun} onChange={e => set('pronoun', e.currentTarget.value)} />
                        </div>
                        <div className="col-span-6">
                            <TextField label="YouTube" placeholder="@handle" value={youtube} onChange={e => set('youtube', e.currentTarget.value)} />
                        </div>
                        <div className="col-span-6">
                            <TextField label="Twitter" placeholder="@handle" value={twitter} onChange={e => set('twitter', e.currentTarget.value)} />
                        </div>
                    </div>
                </CollapsibleContent>
            </Collapsible>

            {/* Character roster / stat editor drill-in */}
            {activeCharDetail !== null ? (
                <CharacterStatEditor
                    scoreboardNumber={scoreboardNumber}
                    teamNumber={teamNumber}
                    charIndex={activeCharDetail}
                    charName={roster[activeCharDetail]}
                    onBack={() => setActiveCharDetail(null)}
                    characterOptions={characterOptions}
                    onCharacterChange={(val) => setCharacter(activeCharDetail, val ?? '')}
                    isCaptain={captain === activeCharDetail}
                    onSetCaptain={() => setCaptain(activeCharDetail)}
                    isSuperstar={rosterStarred[activeCharDetail]}
                    onToggleSuperstar={() => toggleSuperstar(activeCharDetail)}
                    sourceType={sourceType}
                />
            ) : (
                <>
                    <div className="mt-2">
                        <Combobox
                            placeholder="MSB Team"
                            data={teamOptions}
                            clearable
                            value={msbTeam || null}
                            onChange={val => set('msb_team', val ?? '')}
                        />
                    </div>
                    <div className="grid grid-cols-3 gap-1">
                        {roster.map((charName, i) => {
                            const isCaptain = captain === i;
                            const isSuperstar = rosterStarred[i];
                            return (
                                <div
                                    key={i}
                                    className="flex overflow-hidden rounded-md border"
                                    style={{ borderColor: isCaptain ? '#f5bb00' : undefined }}
                                >
                                    <button
                                        type="button"
                                        onClick={() => setActiveCharDetail(i)}
                                        className="min-w-0 flex-1 px-1.5 py-1"
                                    >
                                        <div className="flex flex-nowrap items-center gap-1">
                                            {charName && (
                                                <img src={charIconUrl(charName)} alt="" width={16} height={16} style={{ objectFit: 'contain', flexShrink: 0 }} />
                                            )}
                                            <Text size="xs" truncate dimmed={!charName} span>
                                                {charName || `Slot ${i + 1}`}
                                            </Text>
                                        </div>
                                    </button>
                                    <SimpleTooltip label={isSuperstar ? 'Superstar' : 'Set superstar'}>
                                        <button
                                            type="button"
                                            onClick={() => toggleSuperstar(i)}
                                            className="flex w-[22px] shrink-0 items-center justify-center border-l transition-colors"
                                            style={{ color: isSuperstar ? '#f59f00' : 'var(--color-muted-foreground)' }}
                                        >
                                            <StarIcon active={isSuperstar} superstarUrl={superstarUrl} />
                                        </button>
                                    </SimpleTooltip>
                                    <SimpleTooltip label="Set captain">
                                        <button
                                            type="button"
                                            onClick={() => setCaptain(i)}
                                            className="flex w-[22px] shrink-0 items-center justify-center border-l text-[11px] font-bold transition-colors"
                                            style={{
                                                backgroundColor: isCaptain ? '#f5bb00' : undefined,
                                                color: isCaptain ? '#0a0a0a' : 'var(--color-muted-foreground)',
                                            }}
                                        >
                                            C
                                        </button>
                                    </SimpleTooltip>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}
        </Stack>
    );
});
