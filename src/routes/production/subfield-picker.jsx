import { memo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
    CaptionsOff, Check, ChevronsUpDown, Gamepad2, Globe, IdCard, MapPin, Tag, UserRound,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover';
import { Command, CommandGroup, CommandItem, CommandList } from '../../components/ui/command';
import { cn } from '../../lib/utils';
import { SUBFIELD_OPTIONS, subFieldValue } from '../../context/commentary';
import { SOCIAL_MARKS } from '../../../public/layout/lib/social-marks.js';

/*
 * THE SUB-PLATE PICKER — which address-book field a person's sub-plate draws,
 * chosen by what it will SAY.
 *
 * A bare <select> of field names ("Twitter", "Pronouns") asked the producer to
 * remember, per caster, which fields they had ever filled in — and the answer
 * decides whether anything draws at all: the strip drops a drawer whose value is
 * empty (commentary-mount.js, `showSub = subVisible && subValue`). So a field
 * picked blind was a sub-plate that silently never appeared. Here every field
 * carries the value it resolves to for THIS person, an empty one is visibly
 * empty in the list, and a chosen field that is empty says so on the closed
 * control in amber — which means what amber means everywhere on the console:
 * you would want to know before this is on air.
 *
 * Same Popover + Command shape as ParticipantPicker, the picker that sits beside
 * it, so the two controls on a caster's row open and read alike. There is no
 * search box — a handful of fixed fields are scanned, not searched — so the
 * list itself takes focus on open, which keeps arrow keys and Enter working.
 *
 * The marks: the two platforms wear the brand marks the overlays draw
 * (../../public/layout/lib/social-marks.js — a handle cannot say which platform
 * it is on, on the console any more than on air), the rest a plain glyph each.
 */

const FIELD_ICONS = {
    fullName: IdCard,
    pronoun: UserRound,
    prefix: Tag,
    country: Globe,
    state: MapPin,
    rioName: Gamepad2,
};

const NONE = '__none__';

export const FieldMark = memo(function FieldMark({ field, className }) {
    const brand = SOCIAL_MARKS[field];
    if (brand) {
        return (
            <svg viewBox={brand.viewBox} aria-hidden className={cn('shrink-0', className)}>
                <path d={brand.d} fill="currentColor" />
            </svg>
        );
    }
    const Icon = FIELD_ICONS[field] || CaptionsOff;
    return <Icon aria-hidden className={cn('shrink-0', className)} />;
});

/**
 * @param value        the chosen field key ('' = no sub-plate)
 * @param onChange     (field) => void — '' clears it
 * @param participant  the address-book row the values come from, or null when
 *                     nobody is picked (the list then offers bare field names)
 * @param who          display name for the list heading
 * @param options      the field vocabulary (defaults to the commentary list)
 */
export const SubFieldPicker = memo(function SubFieldPicker({
    value, onChange, participant, who, options = SUBFIELD_OPTIONS,
    ariaLabel = 'Sub-plate field', disabled, className,
}) {
    const [open, setOpen] = useState(false);
    const list = useRef(null);
    const chosen = options.find(o => o.value === value) || null;
    const chosenValue = chosen ? subFieldValue(participant, chosen.value) : '';
    // Only a KNOWN person can be known to lack a value. With nobody picked the
    // field is not empty, it is unanswered, and amber there would cry wolf on
    // every seat the producer has not filled yet.
    const chosenEmpty = !!chosen && !!participant && !chosenValue;
    const anyEmpty = !!participant && options.some(o => !subFieldValue(participant, o.value));

    const pick = (field) => {
        setOpen(false);
        onChange?.(field === NONE ? '' : field);
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild disabled={disabled}>
                <button
                    type="button"
                    role="combobox"
                    aria-expanded={open}
                    aria-label={ariaLabel}
                    disabled={disabled}
                    title={chosenEmpty
                        ? `${who || 'This person'} has no ${chosen.label.toLowerCase()} in the Address Book, so no sub-plate draws.`
                        : undefined}
                    className={cn(
                        'flex h-8 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-2.5 text-sm',
                        'outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50',
                        className,
                    )}
                >
                    {chosen ? (
                        <>
                            <FieldMark field={chosen.value} className="size-3.5 text-muted-foreground" />
                            <span className="shrink-0 text-foreground">{chosen.label}</span>
                            {chosenEmpty ? (
                                <span className="min-w-0 truncate text-xs text-amber-500/90">Empty</span>
                            ) : (
                                <span className="min-w-0 truncate text-xs text-muted-foreground">{chosenValue}</span>
                            )}
                        </>
                    ) : (
                        <>
                            <CaptionsOff aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate text-muted-foreground">No sub-plate</span>
                        </>
                    )}
                    <ChevronsUpDown aria-hidden className="ml-auto size-4 shrink-0 opacity-50" />
                </button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="w-[max(var(--radix-popover-trigger-width),18rem)] p-0"
                onOpenAutoFocus={(e) => { e.preventDefault(); list.current?.focus(); }}
            >
                <Command
                    ref={list} tabIndex={-1} loop
                    defaultValue={value || NONE}
                    className="outline-none"
                    aria-label={ariaLabel}
                >
                    <CommandList className="max-h-[min(70vh,24rem)]">
                        <CommandGroup>
                            <CommandItem value={NONE} onSelect={() => pick(NONE)}>
                                <Check className={cn('size-3.5', value ? 'opacity-0' : 'opacity-100')} />
                                <CaptionsOff className="size-3.5" />
                                <span className="text-muted-foreground">No sub-plate</span>
                            </CommandItem>
                        </CommandGroup>
                        <CommandGroup heading={who ? `${who} — Address Book` : 'Address Book field'}>
                            {options.map((o) => {
                                const v = subFieldValue(participant, o.value);
                                return (
                                    <CommandItem
                                        key={o.value} value={o.value}
                                        onSelect={() => pick(o.value)}
                                        className="gap-2"
                                    >
                                        <Check className={cn('size-3.5', o.value === value ? 'opacity-100' : 'opacity-0')} />
                                        <FieldMark field={o.value} className="size-3.5 text-muted-foreground" />
                                        <span className={cn('w-20 shrink-0', participant && !v && 'text-muted-foreground')}>
                                            {o.label}
                                        </span>
                                        {participant && (v ? (
                                            <span className="min-w-0 truncate text-xs text-muted-foreground">{v}</span>
                                        ) : (
                                            <span className="text-xs italic text-muted-foreground/50">empty</span>
                                        ))}
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                    </CommandList>
                    {anyEmpty && (
                        <p className="border-t border-border/60 px-3 py-2 text-[0.6875rem] leading-snug text-muted-foreground">
                            An empty field draws no sub-plate. Fill it in on the{' '}
                            <Link to="/player_list" className="underline hover:text-foreground">Address Book</Link>.
                        </p>
                    )}
                </Command>
            </PopoverContent>
        </Popover>
    );
});
