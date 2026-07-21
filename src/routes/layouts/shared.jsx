import { memo, useState, useEffect, useCallback, useRef } from 'react';
import { Text } from '../../components/ui/primitives';
import { Label } from '../../components/ui/label';
import { ColorInput } from '../../components/ui/color-input';
import { NumberInput } from '../../components/ui/number-input';
import { cn } from '../../lib/utils';

// Selected-row tint helper (replaces the per-item Mantine theme callbacks).
const itemClass = (active, accent = 'primary') => cn(
    'block w-full rounded-md p-2 text-left transition-colors',
    active
        ? (accent === 'violet' ? 'border border-[#a78bfa] bg-[#a78bfa]/15' : 'border border-primary bg-primary/10')
        : 'border border-transparent hover:bg-accent'
);

// Includes the default values for every "color" / "color-opacity" field in
// GLOBAL_DESIGN_DEFAULTS so a user can always click the suggested swatch to
// restore a stock value: #f59e0b (accent), #0f0f19 (card bg), #ffffff (text /
// border), #000000 (shadows). Remaining entries are general-purpose accents.
const COLOR_SWATCHES = [
    '#f59e0b', '#ef4444', '#22c55e', '#3b82f6',
    '#a855f7', '#ec4899', '#14b8a6', '#f97316',
    '#6366f1', '#64748b',
    '#0f0f19', '#ffffff', '#000000',
];

function parseRgba(val) {
    const m = val.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/);
    if (m) {
        const hex = '#' + [m[1], m[2], m[3]].map(n => parseInt(n).toString(16).padStart(2, '0')).join('');
        return { hex, opacity: m[4] != null ? parseFloat(m[4]) : 1 };
    }
    return { hex: val.startsWith('#') ? val : '#000000', opacity: 1 };
}

function toRgba(hex, opacity) {
    const r = parseInt(hex.slice(1, 3), 16) || 0;
    const g = parseInt(hex.slice(3, 5), 16) || 0;
    const b = parseInt(hex.slice(5, 7), 16) || 0;
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

// ── Debounced color input — updates local display immediately, saves after idle ──
const DebouncedColorInput = memo(function DebouncedColorInput({ value, onChange, ...props }) {
    const [local, setLocal] = useState(value ?? '');
    const timerRef = useRef(null);

    useEffect(() => {
        setLocal(value ?? '');
    }, [value]);

    const handleChange = useCallback((color) => {
        setLocal(color);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            onChange(color);
            timerRef.current = null;
        }, 200);
    }, [onChange]);

    useEffect(() => () => {
        if (timerRef.current) clearTimeout(timerRef.current);
    }, []);

    return <ColorInput {...props} value={local} onChange={handleChange} />;
});

// Labeled color input (debounced) used in the global design grid.
const LabeledColor = memo(function LabeledColor({ label, ...props }) {
    return (
        <div className="flex flex-col gap-1">
            <Label className="field-label">{label}</Label>
            <DebouncedColorInput {...props} />
        </div>
    );
});

const ColorWithOpacity = memo(function ColorWithOpacity({ label, description, value, onChange }) {
    const { hex, opacity } = parseRgba(value);
    const [localHex, setLocalHex] = useState(hex);
    const [localOpacity, setLocalOpacity] = useState(opacity);
    const timerRef = useRef(null);

    useEffect(() => {
        const parsed = parseRgba(value);
        setLocalHex(parsed.hex);
        setLocalOpacity(parsed.opacity);
    }, [value]);

    const scheduleChange = useCallback((newHex, newOpacity) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            onChange(toRgba(newHex, newOpacity));
            timerRef.current = null;
        }, 200);
    }, [onChange]);

    useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

    return (
        <div className="flex flex-col gap-1">
            {label && <Label className="field-label">{label}</Label>}
            {description && <Text size="xs" dimmed>{description}</Text>}
            <div className="flex items-end gap-2">
                <ColorInput
                    value={localHex}
                    onChange={(color) => { setLocalHex(color); scheduleChange(color, localOpacity); }}
                    swatches={COLOR_SWATCHES}
                    className="flex-1"
                />
                <NumberInput
                    value={Math.round(localOpacity * 100)}
                    onChange={(val) => { const o = (val ?? 100) / 100; setLocalOpacity(o); scheduleChange(localHex, o); }}
                    min={0}
                    max={100}
                    step={5}
                    suffix="%"
                    className="w-20"
                />
            </div>
        </div>
    );
});

export { itemClass, COLOR_SWATCHES, parseRgba, toRgba, ColorWithOpacity, LabeledColor, DebouncedColorInput };
