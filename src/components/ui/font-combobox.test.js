import { describe, it, expect } from 'vitest';
import { fontOptions } from './font-combobox';
import { TYPE_ROLE_DEFAULTS } from '../../routes/layouts/designConstants';

const names = (opts) => opts.map(o => o.value);

describe('fontOptions', () => {
    it('pins the three shipped role faces above every other font', () => {
        const opts = fontOptions({ pinned: TYPE_ROLE_DEFAULTS, systemFonts: ['Arial', 'Zapfino'], role: 'display' });
        expect(names(opts).slice(0, 3)).toEqual(['Rajdhani', 'Inter', 'Chivo Mono']);
        expect(opts.slice(0, 3).every(o => o.group === 'Defaults')).toBe(true);
        expect(opts[3].group).toBe('All fonts');
    });

    it("leads with the picker's own role", () => {
        expect(names(fontOptions({ pinned: TYPE_ROLE_DEFAULTS, role: 'mono' }))[0]).toBe('Chivo Mono');
        expect(names(fontOptions({ pinned: TYPE_ROLE_DEFAULTS, role: 'body' }))[0]).toBe('Inter');
    });

    it('lists a pinned face once, and names its role', () => {
        const opts = fontOptions({ pinned: TYPE_ROLE_DEFAULTS, systemFonts: ['Inter', 'Rajdhani'], value: 'Inter', role: 'body' });
        expect(names(opts).filter(n => n === 'Inter')).toHaveLength(1);
        expect(opts[0].detail).toBe('Body default');
        expect(opts.find(o => o.value === 'Chivo Mono').detail).toBe('Numeral default');
    });

    it('keeps a typed font that is in no list', () => {
        expect(names(fontOptions({ pinned: TYPE_ROLE_DEFAULTS, value: 'My House Font' }))).toContain('My House Font');
    });

    it('with nothing pinned is the plain A-Z list', () => {
        const opts = fontOptions({ systemFonts: ['Zapfino'] });
        expect(opts[0]).toBe('Bebas Neue');
        expect(opts.at(-1)).toBe('Zapfino');
    });
});
