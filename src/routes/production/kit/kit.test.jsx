import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '../../../components/ui/tooltip';
import { Eye, EyeOff } from 'lucide-react';
import { chipState, StateChip, ListRow, QuickCard, IconToggle, NumberRow } from './index';

afterEach(cleanup);

// App root provides a single TooltipProvider; mirror that here.
const ui = (node) => render(<TooltipProvider>{node}</TooltipProvider>);

// A useElementBindings-shaped binding for an OBS source item.
const b = (enabled) => ({ item: { enabled }, scene: 'Game', where: 'program' });

describe('chipState — the one status language', () => {
    it('program enabled wins: AIR even when preview is also enabled', () => {
        expect(chipState({ program: b(true), preview: b(true) })).toBe('air');
        expect(chipState({ program: b(true), preview: null })).toBe('air');
    });

    it('preview enabled with program hidden is PVW (staged in OBS)', () => {
        expect(chipState({ program: b(false), preview: b(true) })).toBe('pvw');
        expect(chipState({ program: null, preview: b(true) })).toBe('pvw');
    });

    it('bound anywhere but hidden everywhere is OFF', () => {
        expect(chipState({ program: b(false), preview: null })).toBe('off');
        expect(chipState({ program: null, preview: b(false) })).toBe('off');
    });

    it('no binding anywhere is unbound (—)', () => {
        expect(chipState({ program: null, preview: null })).toBe('unbound');
        expect(chipState({})).toBe('unbound');
        expect(chipState(undefined)).toBe('unbound');
    });
});

describe('StateChip', () => {
    it('derives its label from bindings', () => {
        ui(<StateChip bindings={{ program: b(true), preview: null }} />);
        expect(screen.getByText('AIR')).toHaveAttribute('data-chip-state', 'air');
    });

    it('an explicit state overrides derivation (desk rows)', () => {
        ui(<StateChip state="desk" bindings={{ program: b(true) }} />);
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
