import { useEffect, useMemo, useState } from "react";
import { ChevronsUpDown, UserPlus, Check } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
    Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useParticipantsStore } from "../context/participants";

/* ------------------------------------------------------------------ *
 * ParticipantPicker — the one shared "pick a person" primitive.
 *
 * Resolves an existing address-book row or, on no match, creates one
 * (create-on-enrich) — and optionally lets the user use the raw typed
 * text without saving (the manual escape hatch, for fields like a
 * scoreboard's Rio Name).
 *
 * Props:
 *   value        current display string (e.g. the bound rioName)
 *   selectedId   optional registry id of the current selection. When given, the
 *                checkmark is keyed on row identity (p.id === selectedId) instead
 *                of matching the display string against each row's rioName — the
 *                latter mis-marks when the shown value is a display tag, or when
 *                two people collide on a name.
 *   onResolve    (row) => void     — a registry row was chosen/created
 *   onRawValue   (text) => void    — optional; "Use 'X'" without saving.
 *                                    Omit to force registry-only selection.
 *   buildCreate  (query) => partial for POST /participants. Default seeds
 *                identities.rioName + display.tag from the typed text.
 *   placeholder, leftSection, className, disabled
 * ------------------------------------------------------------------ */
const defaultBuildCreate = (q) => ({
    identities: { rioName: q },
    display: { tag: q },
});

export default function ParticipantPicker({
    value = "",
    selectedId = null,
    onResolve,
    onRawValue,
    buildCreate = defaultBuildCreate,
    placeholder = "Pick or type a name…",
    searchPlaceholder = "Search address book…",
    leftSection = null,
    className,
    disabled = false,
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [busy, setBusy] = useState(false);

    const { participants, load, create } = useParticipantsStore(useShallow(s => ({
        participants: s.participants,
        load: s.load,
        create: s.create,
    })));

    // Lazy-load the registry the first time a picker is opened anywhere.
    useEffect(() => { if (open) load(); }, [open, load]);

    const q = query.trim();
    const ql = q.toLowerCase();
    const matches = useMemo(() => {
        if (!ql) return participants;
        return participants.filter(p => {
            const tag = (p.display?.tag || "").toLowerCase();
            const rio = (p.identities?.rioName || "").toLowerCase();
            const full = (p.display?.fullName || "").toLowerCase();
            return tag.includes(ql) || rio.includes(ql) || full.includes(ql);
        });
    }, [participants, ql]);

    // Exact existing match suppresses the "Add" affordance (avoids dupes).
    const exact = useMemo(
        () => participants.some(p =>
            (p.identities?.rioName || "").toLowerCase() === ql ||
            (p.display?.tag || "").toLowerCase() === ql
        ),
        [participants, ql]
    );

    const choose = (row) => {
        setOpen(false);
        setQuery("");
        onResolve?.(row);
    };

    const handleCreate = async () => {
        if (!q || busy) return;
        setBusy(true);
        try {
            const row = await create(buildCreate(q));
            choose(row);
        } finally {
            setBusy(false);
        }
    };

    const useRaw = () => {
        setOpen(false);
        const text = q;
        setQuery("");
        onRawValue?.(text);
    };

    // Mark by identity when selectedId is supplied; else fall back to matching
    // the display string against the row's rioName (legacy callers).
    const isSelected = (p) => selectedId != null
        ? p.id === selectedId
        : (p.identities?.rioName || "") === value;

    const rowLabel = (p) => p.display?.tag || p.identities?.rioName || "(unnamed)";
    const rowSub = (p) => {
        const bits = [];
        if (p.identities?.rioName && p.identities.rioName !== p.display?.tag) bits.push(p.identities.rioName);
        if (p.display?.fullName) bits.push(p.display.fullName);
        return bits.join(" · ");
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild disabled={disabled}>
                <button
                    type="button"
                    disabled={disabled}
                    className={cn(
                        "flex h-8 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-2.5 py-1 text-sm",
                        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 outline-none disabled:opacity-50",
                        !value && "text-muted-foreground",
                        className
                    )}
                >
                    <span className="flex min-w-0 items-center gap-1.5">
                        {leftSection}
                        <span className="truncate">{value || placeholder}</span>
                    </span>
                    <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                <Command shouldFilter={false}>
                    <CommandInput
                        value={query}
                        onValueChange={setQuery}
                        placeholder={searchPlaceholder}
                    />
                    <CommandList>
                        {matches.length === 0 && !q && (
                            <CommandEmpty>No saved people yet.</CommandEmpty>
                        )}
                        {matches.length > 0 && (
                            <CommandGroup heading="Address book">
                                {matches.map((p) => (
                                    <CommandItem
                                        key={p.id}
                                        value={p.id}
                                        onSelect={() => choose(p)}
                                    >
                                        <Check className={cn(
                                            "mr-1 size-4",
                                            isSelected(p) ? "opacity-100" : "opacity-0"
                                        )} />
                                        <span className="flex min-w-0 flex-col">
                                            <span className="truncate">{rowLabel(p)}</span>
                                            {rowSub(p) && (
                                                <span className="truncate text-xs text-muted-foreground">{rowSub(p)}</span>
                                            )}
                                        </span>
                                    </CommandItem>
                                ))}
                            </CommandGroup>
                        )}
                        {q && (
                            <CommandGroup heading={matches.length ? undefined : "No match"}>
                                {onRawValue && (
                                    <CommandItem value={`__raw__${q}`} onSelect={useRaw}>
                                        Use “{q}” without saving
                                    </CommandItem>
                                )}
                                {!exact && (
                                    <CommandItem value={`__create__${q}`} onSelect={handleCreate} disabled={busy}>
                                        <UserPlus className="mr-1 size-4" />
                                        Add “{q}” to address book
                                    </CommandItem>
                                )}
                            </CommandGroup>
                        )}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
