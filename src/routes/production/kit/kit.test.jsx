import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { Eye, EyeOff } from 'lucide-react';
import { chipFor, StateChip, ListRow, QuickCard, IconToggle, NumberRow, TextRow } from './index';

afterEach(cleanup);

// App root provides a single TooltipProvider; mirror that here.
const ui = (node) => render(<TooltipProvider>{node}</TooltipProvider>);

// A placement, as ./placements builds them.
const at = (where, enabled, scene = 'Game') =>
    ({ scene, where, item: { id: 1, sourceName: 'S', enabled } });

describe('chipFor — the one status language', () => {
    it('reads the program scene as AIR when the source is enabled', () => {
        expect(chipFor(at('program', true))).toBe('air');
    });

    it('reads the studio preview scene as PVW', () => {
        expect(chipFor(at('preview', true))).toBe('pvw');
    });

    it('is OFF wherever the source is hidden', () => {
        expect(chipFor(at('program', false))).toBe('off');
        expect(chipFor(at('preview', false))).toBe('off');
    });

    /*
     * The scene-grouping rule, and the one worth pinning: a source ENABLED in a
     * scene nobody has cut to is not on the broadcast. AIR there would be a lie
     * — the producer's eye still shows the item's own state, so nothing is
     * hidden from them; only the claim about air is withheld.
     */
    it('is OFF in an off-air scene even when the source is enabled', () => {
        expect(chipFor(at('other', true, 'Break'))).toBe('off');
    });

    it('no source at all is unbound (—)', () => {
        expect(chipFor({ where: 'none', item: null })).toBe('unbound');
        expect(chipFor(null)).toBe('unbound');
        expect(chipFor(undefined)).toBe('unbound');
    });

    /*
     * A fed element takes BOTH conditions. Its container holds one feed, so
     * reading the container's enabled state alone made Character Spotlight and
     * Game Summary both say AIR while at most one could be on screen — two rows
     * sharing one scene item, and one of them lying.
     */
    describe('a fed row is on air only if its container is carrying it', () => {
        // A real slot row as either builder makes it: `slot` names the container
        // it is a member of, `parent` is the row it nests under.
        const fed = (where, enabled, mine) =>
            ({ ...at(where, enabled), slot: 'callout', parent: 'callout@Game', mine });

        it('is AIR when the container is up and the feed is mine', () => {
            expect(chipFor(fed('program', true, true))).toBe('air');
            expect(chipFor(fed('preview', true, true))).toBe('pvw');
        });

        it('is OFF when the container is up but carrying someone else', () => {
            expect(chipFor(fed('program', true, false))).toBe('off');
        });

        it('is OFF when the feed is mine but the container is hidden', () => {
            expect(chipFor(fed('program', false, true))).toBe('off');
        });

        // The container itself keeps the plain reading — it IS the source.
        it('leaves the container row reading its own source', () => {
            expect(chipFor(at('program', true))).toBe('air');
        });

        /*
         * WHICH KIND OF ROW THIS IS COMES FROM `slot`, the same field
         * `isFedPlacement` reads — not `parent`. The two travel together on a row
         * either builder produced, so the difference only shows on one RESOLVED
         * from a stored id, which `sourcelessPlacement` rebuilds with its slot and
         * no parent. Asked the old way, that row skipped the carrying test and
         * could claim AIR for content the container is not showing.
         */
        it('reads a parentless slot row as fed all the same', () => {
            const resolved = { ...at('program', true), slot: 'callout', mine: false };
            expect(chipFor(resolved)).toBe('off');
            expect(chipFor({ ...resolved, mine: true })).toBe('air');
        });
    });
});

describe('StateChip', () => {
    it('renders the state it is given', () => {
        ui(<StateChip state={chipFor(at('program', true))} />);
        expect(screen.getByText('AIR')).toHaveAttribute('data-chip-state', 'air');
    });

    // Desks have no OBS source at all, so they name their state outright.
    it('takes a state that no placement could derive (desk rows)', () => {
        ui(<StateChip state="desk" />);
        expect(screen.getByText('DESK')).toHaveAttribute('data-chip-state', 'desk');
    });

    it('an unknown state falls back to unbound', () => {
        ui(<StateChip state="bogus" />);
        expect(screen.getByText('—')).toHaveAttribute('data-chip-state', 'bogus');
    });
});

describe('ListRow expansion', () => {
    it('without children it is not expandable: no aria-expanded, no toggle', () => {
        ui(<ListRow name="Caster 1" meta="ready" />);
        const btn = screen.getByRole('button');
        expect(btn).not.toHaveAttribute('aria-expanded');
        expect(btn).toBeDisabled();
    });

    it('uncontrolled: clicking the name toggles the expanded content in place', () => {
        ui(<ListRow name="Slot 1"><span>slot editor</span></ListRow>);
        expect(screen.queryByText('slot editor')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { expanded: false }));
        expect(screen.getByText('slot editor')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { expanded: true }));
        expect(screen.queryByText('slot editor')).not.toBeInTheDocument();
    });

    it('defaultExpanded renders open', () => {
        ui(<ListRow name="Slot 1" defaultExpanded><span>slot editor</span></ListRow>);
        expect(screen.getByText('slot editor')).toBeInTheDocument();
    });

    it('controlled: the parent owns the state; clicks only report intent', () => {
        const onExpandedChange = vi.fn();
        ui(
            <ListRow name="Slot 1" expanded={false} onExpandedChange={onExpandedChange}>
                <span>slot editor</span>
            </ListRow>,
        );
        fireEvent.click(screen.getByRole('button', { expanded: false }));
        expect(onExpandedChange).toHaveBeenCalledWith(true);
        expect(screen.queryByText('slot editor')).not.toBeInTheDocument();
    });

    it('disabled rows do not toggle', () => {
        ui(<ListRow name="Slot 1" disabled><span>slot editor</span></ListRow>);
        fireEvent.click(screen.getByRole('button'));
        expect(screen.queryByText('slot editor')).not.toBeInTheDocument();
    });
});

/*
 * A row whose primary content is itself editable (a person picker, a slot type
 * select) passes a node for `name`. Wrapping that in the expand button would
 * make it inert, so the chevron has to carry the affordance instead.
 */
describe('ListRow with an editable name', () => {
    it('renders the control directly and keeps it clickable', () => {
        const onChange = vi.fn();
        ui(<ListRow name={<input aria-label="Caster" onChange={onChange} />} />);
        const input = screen.getByLabelText('Caster');
        fireEvent.change(input, { target: { value: 'Ana' } });
        expect(onChange).toHaveBeenCalled();
    });

    it('expands from its chevron, not from the editable name', () => {
        ui(
            <ListRow name={<input aria-label="Caster" />}>
                <span>slot editor</span>
            </ListRow>,
        );
        expect(screen.queryByText('slot editor')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
        expect(screen.getByText('slot editor')).toBeInTheDocument();
    });

    it('a disabled row does not expand', () => {
        ui(<ListRow name={<input aria-label="Caster" />} disabled><span>slot editor</span></ListRow>);
        fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
        expect(screen.queryByText('slot editor')).not.toBeInTheDocument();
    });
});

describe('IconToggle', () => {
    it('swaps to the off icon and reports pressed state', () => {
        const { rerender } = ui(
            <IconToggle icon={Eye} offIcon={EyeOff} on label="On air" onClick={() => {}} />,
        );
        expect(screen.getByRole('button', { name: 'On air' })).toHaveAttribute('aria-pressed', 'true');
        rerender(
            <TooltipProvider>
                <IconToggle icon={Eye} offIcon={EyeOff} on={false} label="Hidden" onClick={() => {}} />
            </TooltipProvider>,
        );
        expect(screen.getByRole('button', { name: 'Hidden' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('does not fire while disabled', () => {
        const onClick = vi.fn();
        ui(<IconToggle icon={Eye} label="Sub-plate" disabled onClick={onClick} />);
        fireEvent.click(screen.getByRole('button', { name: 'Sub-plate' }));
        expect(onClick).not.toHaveBeenCalled();
    });
});

describe('NumberRow', () => {
    it('reports numbers, and null when cleared', () => {
        const onChange = vi.fn();
        ui(<NumberRow label="Hold" value={1500} suffix="ms" onChange={onChange} />);
        const input = screen.getByRole('spinbutton');
        fireEvent.change(input, { target: { value: '2000' } });
        expect(onChange).toHaveBeenCalledWith(2000);
        fireEvent.change(input, { target: { value: '' } });
        expect(onChange).toHaveBeenLastCalledWith(null);
    });
});

/*
 * A console text field writes to State or Settings, and both broadcast to every
 * overlay. Committing per keystroke sent one write per letter — which the lower
 * third read as a content change and answered by replaying its intro animation,
 * so the band re-animated on every character the producer typed.
 *
 * The field therefore echoes locally and writes once you stop. What these pin
 * is the part that makes that safe: nothing typed is ever lost.
 */
describe('TextRow debounce', () => {
    afterEach(() => vi.useRealTimers());

    it('writes once the typing stops, not once per keystroke', () => {
        vi.useFakeTimers();
        const onChange = vi.fn();
        ui(<TextRow label="Title" value="" onChange={onChange} />);
        const input = screen.getByLabelText('Title');
        for (const v of ['W', 'Wi', 'Win']) fireEvent.change(input, { target: { value: v } });

        expect(onChange).not.toHaveBeenCalled();
        expect(input).toHaveValue('Win');       // the field still keeps up

        vi.advanceTimersByTime(400);
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('Win');
    });

    it('commits on blur rather than making you wait', () => {
        vi.useFakeTimers();
        const onChange = vi.fn();
        ui(<TextRow label="Title" value="" onChange={onChange} />);
        const input = screen.getByLabelText('Title');
        fireEvent.change(input, { target: { value: 'Finals' } });
        fireEvent.blur(input);
        expect(onChange).toHaveBeenCalledWith('Finals');
    });

    // Selecting another lower-third slot mid-word destroys this field. The
    // keystrokes still have to land, or the debounce quietly eats edits.
    it('commits a pending edit when the field is unmounted', () => {
        vi.useFakeTimers();
        const onChange = vi.fn();
        const { unmount } = ui(<TextRow label="Title" value="" onChange={onChange} />);
        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Half typed' } });
        unmount();
        expect(onChange).toHaveBeenCalledWith('Half typed');
    });

    // An upstream change (a slot reorder, another surface) must reach the field
    // — but never over the top of a word in progress.
    it('takes an upstream value, unless something is pending', () => {
        vi.useFakeTimers();
        const onChange = vi.fn();
        const { rerender } = ui(<TextRow label="Title" value="one" onChange={onChange} />);
        rerender(<TooltipProvider><TextRow label="Title" value="two" onChange={onChange} /></TooltipProvider>);
        expect(screen.getByLabelText('Title')).toHaveValue('two');

        fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'typing' } });
        rerender(<TooltipProvider><TextRow label="Title" value="three" onChange={onChange} /></TooltipProvider>);
        expect(screen.getByLabelText('Title')).toHaveValue('typing');
    });
});

describe('QuickCard two-row cap', () => {
    it('renders at most two quick-face rows — the cap is hard', () => {
        ui(
            <QuickCard title="Scoreboard" state="off">
                <div>row one</div>
                <div>row two</div>
                <div>row three</div>
            </QuickCard>,
        );
        expect(screen.getByText('row one')).toBeInTheDocument();
        expect(screen.getByText('row two')).toBeInTheDocument();
        expect(screen.queryByText('row three')).not.toBeInTheDocument();
    });
});
