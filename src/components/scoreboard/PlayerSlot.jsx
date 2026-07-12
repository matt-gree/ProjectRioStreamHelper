import { memo, useCallback, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { Stack, Text } from '../ui/primitives';
import { TextField } from '../ui/text-field';
import { Combobox } from '../ui/combobox';
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
    const rioName    = player?.rioName ?? '';
    const msbTeam    = player?.msb_team ?? '';
    const captain    = player?.rio_captainIndex ?? 0;
    const rioOverride = player?.rioName_override ?? '';

    // Feed boards (HUD / a loaded live game) rewrite the player name every
    // frame, so a hand-typed name only sticks as a server-side override. Manual
    // boards edit rioName directly. `overridden` marks the special pinned state.
    const isFeed = sourceType === 'hud' || sourceType === 'live_game';
    const overridden = isFeed && !!rioOverride;

    const setItem = useStateStore(s => s.setItem);
    const setItems = useStateStore(s => s.setItems);

    const set = useCallback((field, value) => {
        setItem(`${basePath}.${field}`, value);
    }, [basePath, setItem]);

    // Pin (or, with an empty value, clear) this slot's name override. The
    // server makes the override the slot's identity — it drives the overlay
    // name, resurface, the match gate, and a fresh stats fetch — and keeps it
    // stuck against feed updates until the next HUD game.
    const setNameOverride = useCallback(async (value) => {
        try {
            await fetch(
                `/api/v1/scoreboards/${scoreboardNumber}/player/${teamNumber}/name-override`
                    + `?name=${encodeURIComponent(value ?? '')}`,
                { method: 'PUT' },
            );
        } catch { /* state unchanged on failure — nothing to roll back */ }
    }, [scoreboardNumber, teamNumber]);

    // Typing a raw name: on a feed board it becomes an override; on a manual
    // board it writes rioName directly.
    const handleRawName = useCallback((text) => {
        if (isFeed) setNameOverride(text);
        else set('rioName', text);
    }, [isFeed, setNameOverride, set]);

    // Picking a person from the address book copies their enrichment into the
    // player sub-tree in one batch (resolve-by-copy). Picking "use without
    // saving" just sets the raw rioName, preserving the manual escape hatch.
    const resolveParticipant = useCallback((row) => {
        // On a feed board a full copy would be overwritten next frame, so pin
        // the picked person's rioName as the override instead — the server
        // resurfaces the rest of their profile from the registry on re-apply.
        if (isFeed) {
            const picked = row?.identities?.rioName || row?.display?.tag || '';
            if (picked) setNameOverride(picked);
            return;
        }
        const entries = participantToScoreEntries(row, basePath);
        if (entries.length) setItems(entries);
    }, [basePath, setItems, isFeed, setNameOverride]);

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
            {/* Main row: tag + Rio name */}
            <div className="grid grid-cols-12 items-end gap-2.5">
                <div className="col-span-5">
                    <TextField
                        label={`Player ${teamNumber}`}
                        placeholder="Tag"
                        value={name}
                        onChange={e => set('name', e.currentTarget.value)}
                    />
                </div>
                <div className="col-span-7">
                    <Stack gap={4}>
                        <div className="flex h-4 items-center justify-between">
                            <Text size="xs" dimmed span>Rio Name</Text>
                            {overridden && (
                                <button
                                    type="button"
                                    onClick={() => setNameOverride('')}
                                    className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400 hover:text-amber-300"
                                    title="Revert to the HUD name"
                                >
                                    Override
                                    <X size={11} />
                                </button>
                            )}
                        </div>
                        <ParticipantPicker
                            value={rioName}
                            placeholder="Online ID"
                            onResolve={resolveParticipant}
                            onRawValue={handleRawName}
                            className={overridden ? 'border-amber-400 ring-1 ring-amber-400/40' : undefined}
                            leftSection={<img src="/game_assets/rio_logo.png" alt="Rio" width={16} height={16} style={{ objectFit: 'contain' }} />}
                        />
                    </Stack>
                </div>
            </div>

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
