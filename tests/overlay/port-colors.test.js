import { describe, it, expect } from 'vitest';
import { DEFAULT_PORT_COLORS, inkOn } from '../../public/layout/lib/port-colors.js';

/*
 * Text ON a port colour. The scoreboard's live row fills its AB / P tag with
 * `--sideN` and puts a label inside it, and the shipped palette contains one
 * colour where the obvious answer is wrong: port 3 is #fdd835.
 *
 * This is the kind of thing that ships. White-on-yellow is legible enough on a
 * 27" monitor at 100% while you are building the scene, and unreadable in a
 * stream at 1080p — so nobody catches it until a producer whose player is on
 * port 3 goes live. Hence a computed answer and a test over the real palette
 * rather than a fixed fill.
 */
describe('inkOn — readable text on a port colour', () => {
    it('reads dark on the yellow port and light on the other three', () => {
        expect(DEFAULT_PORT_COLORS.map(inkOn))
            .toEqual(['#ffffff', '#ffffff', '#0b0b12', '#ffffff']);
    });

    it('answers for a producer’s own repaint, not just the shipped four', () => {
        // The Design tab lets any port be any colour, so the palette above is a
        // sample of the input space rather than the whole of it.
        expect(inkOn('#ffffff')).toBe('#0b0b12');
        expect(inkOn('#000000')).toBe('#ffffff');
        expect(inkOn('#00ff00')).toBe('#0b0b12'); // green is the bright one people miss
    });

    /*
     * Light text is the safe default: every card this is used on has a dark
     * ground, so an unparseable value that fell through to DARK ink would draw
     * a label that is invisible rather than merely low-contrast.
     */
    it('falls back to light ink for anything it cannot read', () => {
        for (const bad of ['', null, undefined, 'var(--side1)', 'rgb(1,2,3)', '#abc']) {
            expect(inkOn(bad)).toBe('#ffffff');
        }
    });
});
