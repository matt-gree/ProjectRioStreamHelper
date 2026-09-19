import { memo, useEffect, useRef, useState } from 'react';
import { ChevronsUpDown, Check } from 'lucide-react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../../../components/ui/command';
import { useAssetUrls } from '../../../lib/assets';
import { usePortColors } from '../../design/designPackage';
import { MSB_CAPTAINS } from '../../../data/msb';
import { Popover, PopoverTrigger, PopoverContent } from '../../../components/ui/popover';
import { cn } from '../../../lib/utils';
import { DB_FIELD } from './draft';

// The desk's dense pickers — captain grid, port swatches, game mode — that the
// row kit deliberately does not try to express.

// Captain character icon, with a graceful fallback to initials when the image
// pack isn't installed (404). `size` in px for both the box and the image.
const CaptainIcon = memo(function CaptainIcon({ name, urls, size = 34 }) {
    const [broken, setBroken] = useState(false);
    if (broken) {
        const initials = name.split(' ').map(w => w[0]).join('').slice(0, 2);
        return <span className="text-[10px] font-semibold leading-none text-muted-foreground">{initials}</span>;
    }
    return (
        <img
            src={urls.charIcon(name)} alt="" width={size} height={size}
            onError={() => setBroken(true)}
            className="object-contain"
            style={{ width: size, height: size }}
        />
    );
});

/*
 * The captain picker — a board of character icons, faster to scan and hit than
 * a scroll list. Keyboard: type a captain's first letter to select it;
 * repeating the same letter cycles through every captain that starts with it
 * (B → Birdo → Bowser → Bowser Jr, D → Daisy → Diddy → DK).
 *
 * It renders inline on the desk rather than inside a dropdown. There are only
 * twelve captains and a producer sets one every game, so a popover was a click
 * and a mode spent hiding a control that fits — the stage shows what it has
 * room to show (production-console-contract). Inline it also gives the sides
 * the height that used to be a void above the board chips.
 */
export const CaptainGrid = memo(function CaptainGrid({
    value, onChange, autoFocus = false, iconSize = 34, className,
}) {
    const urls = useAssetUrls();
    const ref = useRef(null);
    useEffect(() => { if (autoFocus) ref.current?.focus(); }, [autoFocus]);

    const onKeyDown = (e) => {
        if (e.key.length !== 1 || !/[a-z]/i.test(e.key)) return;
        const letter = e.key.toUpperCase();
        const group = MSB_CAPTAINS.filter(c => c[0].toUpperCase() === letter);
        if (!group.length) return;
        e.preventDefault();
        const at = group.indexOf(value);
        onChange(at === -1 ? group[0] : group[(at + 1) % group.length]);
    };

    return (
        <div
            ref={ref}
            role="listbox"
            aria-label="Captain"
            tabIndex={0}
            onKeyDown={onKeyDown}
            className={cn('grid grid-cols-4 gap-1 outline-none', className)}
        >
            {MSB_CAPTAINS.map((c) => {
                const selected = value === c;
                return (
                    /* No tooltip. Twelve of them on one board fire constantly
                       as the pointer crosses to a target, and the portraits are
                       the recognisable thing — the name adds nothing a producer
                       needs. aria-label carries the name instead, since the
                       cell's only content is an alt="" image and dropping the
                       tooltip would otherwise leave it with no accessible name. */
                    <button
                        key={c}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        aria-label={c}
                        onClick={() => onChange(selected ? '' : c)}
                        className={cn(
                            // Fixed cell, not aspect-square: it has to match the
                            // port board's 24px so the two loadout boards stand
                            // exactly the same height. The pair has to clear a
                            // ~224px side at standard window width — 6×24 plus
                            // gaps is 164 of it.
                            'flex size-6 items-center justify-center rounded-md border transition-colors',
                            selected
                                ? 'border-primary bg-primary/15 ring-1 ring-primary'
                                : 'border-transparent hover:border-border hover:bg-muted/40',
                        )}
                    >
                        <CaptainIcon name={c} urls={urls} size={iconSize} />
                    </button>
                );
            })}
        </div>
    );
});

/*
 * Controller port for a side — a 2×2 board of the four ports, one touch like
 * the captain grid beside it. Stored 0-indexed (matches the HUD's Away/Home
 * Port and the projected score.{N}.player.{T}.port).
 *
 * Each cell carries its port's broadcast colour — the RESOLVED one (Design tab
 * → Controller Ports, under it the active package's own palette), not a copy of
 * the stock four, so the producer picks against the colour the overlay will
 * actually draw under whatever package is loaded. Clicking the selected port
 * clears it, exactly as the captain grid clears a captain — no separate "None"
 * row.
 *
 * 2×2 is also what makes the mirrored loadout fit: this is ~60px where the
 * dropdown it replaced was ~90, which is the width the two sides were fighting
 * over across the spine.
 */
export const PortGrid = memo(function PortGrid({ value, onChange, className }) {
    const idx = value === '' || value == null ? null : Number(value);
    const ports = usePortColors();
    return (
        <div role="listbox" aria-label="Controller port" className={cn('grid w-fit grid-cols-2 gap-1', className)}>
            {[0, 1, 2, 3].map((p) => {
                const selected = idx === p;
                return (
                    /* No tooltip — the digit already says which port it is, so
                       one would only restate the cell's own content. */
                    <button
                        key={p}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        aria-label={`Port ${p + 1}`}
                        onClick={() => onChange(selected ? null : p)}
                        style={{ color: ports[p].color }}
                        className={cn(
                            'flex size-6 items-center justify-center rounded-md border text-[10px] font-semibold tabular-nums transition-colors',
                            selected
                                ? 'border-current ring-1 ring-current'
                                : 'border-transparent opacity-45 hover:border-border hover:opacity-100',
                        )}
                    >
                        {p + 1}
                    </button>
                );
            })}
        </div>
    );
});

/*
 * Searchable game-mode combobox (Popover + Command). Flex-fills the settings
 * row; the value is the raw game-mode name (empty = unset).
 *
 * `modes` is the two-tier catalogue (../board/gamemodes): this season's modes first,
 * ended ones under their own heading. A fixture is often authored for a season
 * that has closed — and the mode it carries is projected onto the board it binds
 * to — so the active list alone could not name half of them.
 */
export const GameModeSelect = memo(function GameModeSelect({ value, modes, onChange, className }) {
    const [open, setOpen] = useState(false);
    const choose = (v) => { onChange(v); setOpen(false); };
    // Group name -> items, in first-appearance order (an ungrouped list stays
    // one unheaded section).
    const sections = [];
    for (const m of modes) {
        const item = typeof m === 'string' ? { value: m, label: m, group: null } : m;
        const section = sections.find(s => s.name === (item.group ?? null));
        if (section) section.items.push(item);
        else sections.push({ name: item.group ?? null, items: [item] });
    }
    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className={cn(DB_FIELD, 'flex items-center justify-between gap-1.5',
                        !value && 'text-muted-foreground', className)}
                >
                    <span className="truncate">{value || 'Game mode…'}</span>
                    <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
                </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-52 p-0">
                <Command>
                    <CommandInput placeholder="Search modes…" />
                    <CommandList>
                        <CommandEmpty>No mode.</CommandEmpty>
                        <CommandGroup>
                            <CommandItem value="__none__" onSelect={() => choose('')}>
                                <span className="text-muted-foreground">None</span>
                                <Check className={cn('ml-auto size-4', !value ? 'opacity-100' : 'opacity-0')} />
                            </CommandItem>
                        </CommandGroup>
                        {sections.map(section => (
                            <CommandGroup key={section.name ?? '__all__'} heading={section.name ?? undefined}>
                                {section.items.map(item => (
                                    <CommandItem key={item.value} value={item.value} onSelect={() => choose(item.value)}>
                                        <span className="truncate">{item.label}</span>
                                        <Check className={cn('ml-auto size-4', value === item.value ? 'opacity-100' : 'opacity-0')} />
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        ))}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
});
