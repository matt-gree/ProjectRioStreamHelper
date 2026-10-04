import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Text } from '../../../components/ui/primitives';
import { Checkbox } from '../../../components/ui/checkbox';
import ScaledIframe from '../../../components/ScaledIframe';
import { cn } from '../../../lib/utils';
import { CONTAINER_MEMBERS, groupMembers, hostOf, isSharedMember, useContainerDefs } from './containers';

/*
 * THE MEMBER PICKER — one surface for every "what goes on this container"
 * question: building a new one, and adding to one that exists.
 *
 * A grouped list in its OWN scroll area beside a preview of whatever the
 * pointer is on. The list scrolls and the page does not, so the preview and the
 * buttons under both stay where the eye left them.
 *
 * Each row says only what is true of IT: its size, and — in amber, because it is
 * a consequence — that ticking it moves it off another container or grows this
 * one. Nothing explains the picker; the preview is what tells one member from
 * another.
 */
export const MemberPicker = memo(function MemberPicker({
    selected, onToggle, exclude = [], target = null, onPreview, height = 320,
}) {
    const defs = useContainerDefs();
    const [peek, setPeek] = usePeek(onPreview);
    const candidates = CONTAINER_MEMBERS.filter(el => !exclude.includes(el.id));

    const list = (
        <div
            className={cn('flex min-w-0 flex-col', !onPreview && 'overflow-y-auto pr-1')}
            style={onPreview ? undefined : { height }}
        >
            {groupMembers(candidates).map(({ label, members: group }) => (
                <div key={label} className="flex flex-col">
                    <MemberGroupLabel>{label}</MemberGroupLabel>
                    {group.map((el) => {
                        // Ticking a member another container holds MOVES it here
                        // (unless it is shared); one bigger than the target grows it.
                        const held = isSharedMember(el) ? null : hostOf(defs, el.id);
                        const moves = held && held !== target?.id ? (defs[held]?.name ?? held) : null;
                        const grows = target && (el.width > target.width || el.height > target.height);
                        return (
                            <label
                                key={el.id}
                                onMouseEnter={() => setPeek(el)}
                                onFocus={() => setPeek(el)}
                                className={cn(
                                    'flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 hover:bg-accent/50',
                                    peek?.id === el.id && 'bg-accent/40',
                                )}
                            >
                                <Checkbox
                                    checked={selected.includes(el.id)}
                                    onCheckedChange={() => onToggle(el.id)}
                                    aria-label={el.name}
                                    className="border-muted-foreground/70"
                                />
                                <Text size="xs" span truncate className="min-w-0 flex-1 text-foreground">{el.name}</Text>
                                {moves && <Text size="xs" span truncate className="text-amber-400/90">from {moves}</Text>}
                                <Text size="xs" span className={cn('shrink-0 tabular-nums', grows ? 'text-amber-400/90' : 'text-muted-foreground')}>
                                    {el.width} × {el.height}
                                </Text>
                            </label>
                        );
                    })}
                </div>
            ))}
        </div>
    );

    // With a parent that owns a preview (the Add picker's right pane), hand it
    // the member; otherwise draw one beside the list.
    if (onPreview) return list;
    return (
        <div className="grid grid-cols-[minmax(0,19rem)_minmax(0,1fr)] gap-4">
            {list}
            <PreviewFrame
                src={memberPreviewUrl(peek)} width={peek?.width} height={peek?.height}
                h={height} title={peek ? `${peek.name} preview` : 'Preview'}
                empty="Point at a member to preview it"
            />
        </div>
    );
});

// A group heading in a member list — small caps, a tier quieter than the rows.
export function MemberGroupLabel({ children }) {
    return (
        <Text size="xs" span className="label-display px-2 pt-2 pb-0.5 text-[10px] tracking-wider text-muted-foreground/80">
            {children}
        </Text>
    );
}

/*
 * Which member the pointer is on. Debounced: each change reloads an overlay
 * page, and sweeping the pointer down twenty rows must not load twenty.
 */
function usePeek(onPreview) {
    const [peek, setPeekNow] = useState(null);
    const timer = useRef(null);
    useEffect(() => () => clearTimeout(timer.current), []);
    const setPeek = (el) => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            setPeekNow(el);
            onPreview?.(el);
        }, 120);
    };
    return [peek, setPeek];
}

// A member's own layout, drawing its sample bundle.
export const memberPreviewUrl = el => (el?.url ? `${el.url}${el.url.includes('?') ? '&' : '?'}preview=1&sample=1` : null);

/*
 * A preview box: the overlay in an iframe, letterboxed into a fixed height on a
 * checkerboard sized to the overlay itself, so transparency reads as the
 * overlay's own and the surround reads as empty room. One iframe — never one
 * per row; each is a full overlay page on a machine also running the game.
 */
export function PreviewFrame({ src, width, height, h, title, empty, caption }) {
    const [fit, setFit] = useState(null);
    // Same-fit guard: ScaledIframe reports on every measure, and a fresh object
    // each time would re-render this box for nothing.
    const onFit = useCallback((f) => {
        setFit(prev => (prev && prev.w === f.w && prev.h === f.h ? prev : f));
    }, []);
    return (
        <div className="flex min-w-0 flex-col gap-1">
            <div
                className="relative flex items-center justify-center overflow-hidden rounded-md border border-border/60 bg-background/40"
                style={{ height: h }}
            >
                {src && fit && (
                    <div
                        aria-hidden="true"
                        className="absolute"
                        style={{
                            width: fit.w,
                            height: fit.h,
                            backgroundColor: '#15151c',
                            backgroundImage:
                                'linear-gradient(45deg,#20202a 25%,transparent 25%,transparent 75%,#20202a 75%),'
                                + 'linear-gradient(45deg,#20202a 25%,transparent 25%,transparent 75%,#20202a 75%)',
                            backgroundSize: '16px 16px',
                            backgroundPosition: '0 0, 8px 8px',
                        }}
                    />
                )}
                {src ? (
                    <ScaledIframe
                        key={src}
                        src={src}
                        nativeWidth={width}
                        nativeHeight={height}
                        height={h}
                        onFit={onFit}
                        title={title}
                        className="absolute inset-0"
                    />
                ) : (
                    <Text size="xs" dimmed>{empty}</Text>
                )}
            </div>
            {caption && <Text size="xs" span dimmed className="truncate">{caption}</Text>}
        </div>
    );
}
