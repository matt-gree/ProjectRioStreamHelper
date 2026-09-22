/*
 * The three TYPE ROLES, tested against overlay-base.js itself.
 *
 * These are behavioural rather than the string-matching the sibling tests use,
 * because the rule that matters here is a NEGATIVE one — `clearDesignSettings`
 * removing everything EXCEPT the type roles — and "this var is not in that
 * list" is exactly the kind of claim a source search gets wrong when the list
 * is later built from somewhere else.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('public/layout/lib/overlay-base.js', 'utf8');

function boot(settings) {
    document.head.innerHTML = '';
    document.documentElement.removeAttribute('style');
    // Classic script, not a module: run it and read the global it installs.
    new Function(SRC)();
    const OB = window.OverlayBase;
    setSettings(OB, settings);
    return OB;
}

/*
 * `settings` is exported BY REFERENCE — the socket handlers deepSet into that
 * same object — so a test that reassigns `OB.settings` leaves every reader
 * looking at the original and silently tests nothing.
 */
function setSettings(OB, next) {
    for (const k of Object.keys(OB.settings)) delete OB.settings[k];
    Object.assign(OB.settings, next);
}

const roleVars = () => {
    const s = document.documentElement.style;
    return {
        display: s.getPropertyValue('--font-display'),
        body: s.getPropertyValue('--font-body'),
        mono: s.getPropertyValue('--font-mono'),
    };
};
const fontHref = () => document.getElementById('dynamic-font-link')?.href ?? null;

beforeEach(() => {
    document.documentElement.removeAttribute('style');
    document.head.innerHTML = '';
});

describe('type roles', () => {
    it('defaults to the token layer, so an untouched install draws what it drew', () => {
        const OB = boot({});
        OB.applyDesignSettings('scoreboard');
        const r = roleVars();
        expect(r.display).toContain('Rajdhani');
        expect(r.body).toContain('Inter');
        expect(r.mono).toContain('Chivo Mono');
        // Nothing chosen, so nothing is fetched.
        expect(fontHref()).toBeNull();
    });

    it('takes the producer global and fetches the faces the page lacks', () => {
        const OB = boot({ overlays: { global: { displayFont: 'Bebas Neue', monoFont: 'Roboto Mono' } } });
        OB.applyDesignSettings('scoreboard');
        const r = roleVars();
        expect(r.display).toContain('Bebas Neue');
        expect(r.mono).toContain('Roboto Mono');
        // Body untouched, and Inter is bundled, so it is never in the request.
        expect(r.body).toContain('Inter');
        expect(fontHref()).toContain('family=Bebas+Neue');
        expect(fontHref()).toContain('family=Roboto+Mono');
        expect(fontHref()).not.toContain('Inter');
    });

    it('lets a per-element pin beat the global', () => {
        const OB = boot({
            overlays: { global: { displayFont: 'Bebas Neue' }, eventheader: { displayFont: 'Oswald' } },
        });
        OB.applyDesignSettings('eventheader');
        expect(roleVars().display).toContain('Oswald');
        OB.applyDesignSettings('scoreboard');
        expect(roleVars().display).toContain('Bebas Neue');
    });

    /*
     * THE RULE THIS FEATURE RESTS ON. A fixed-palette package (no
     * data-design-vars="app") has its mount call clearDesignSettings instead of
     * applyDesignSettings, and the old single font var was in the cleared set —
     * which is why the Design tab's font knob reached four layouts out of
     * eighteen and setting it split the broadcast in half. Type is not palette:
     * the artwork's colours are the package's decision, the face a name is set
     * in is the organisation's.
     */
    it('survives the palette clear a fixed-palette package performs', () => {
        const OB = boot({
            overlays: { global: { displayFont: 'Bebas Neue', accentColor: '#ff0000' } },
        });
        OB.applyDesignSettings('scoreboard');
        expect(document.documentElement.style.getPropertyValue('--accent')).toBe('#ff0000');

        OB.clearDesignSettings('scoreboard');
        // The palette goes...
        expect(document.documentElement.style.getPropertyValue('--accent')).toBe('');
        // ...and the type stays.
        expect(roleVars().display).toContain('Bebas Neue');
        expect(roleVars().mono).toContain('Chivo Mono');
    });

    it('honours a per-element pin through the clear too', () => {
        const OB = boot({ overlays: { scorecard: { '2': { monoFont: 'Lalezar' } } } });
        OB.clearDesignSettings('scorecard', 'scorecard.2');
        expect(roleVars().mono).toContain('Lalezar');
    });

    /*
     * The link is REBUILT from the current set, never appended to. Three roles
     * can name three faces and a producer trying fonts out changes them one at
     * a time, so an append-only link would accumulate every face tried this
     * session — and the request that matters is the last one.
     */
    it('drops a face from the request when its role goes back to a default', () => {
        const OB = boot({ overlays: { global: { displayFont: 'Bebas Neue', monoFont: 'Roboto Mono' } } });
        OB.applyDesignSettings('scoreboard');
        expect(fontHref()).toContain('Bebas+Neue');

        setSettings(OB, { overlays: { global: { monoFont: 'Roboto Mono' } } });
        OB.applyDesignSettings('scoreboard');
        expect(fontHref()).toContain('Roboto+Mono');
        expect(fontHref()).not.toContain('Bebas+Neue');

        // Every role back to a resident face: the link goes away entirely.
        setSettings(OB, {});
        OB.applyDesignSettings('scoreboard');
        expect(fontHref()).toBeNull();
    });
});
