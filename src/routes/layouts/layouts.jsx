import { useState, useEffect } from 'react';
import { Stack } from '../../components/ui/primitives';
import { DesignTabBody } from './design';

/*
 * The Design tab — global overlay design, a live preview gallery, and design
 * packages / presets / branding.
 *
 * This was the Setup tab: a layout BROWSER with per-group modes
 * (scoreboard/scenes/talent/break/shared/bracket/controller) that let a producer
 * preview a layout, copy its URL, add it to OBS, and tune its settings. Every
 * one of those jobs moved into the Production console (v2 phase 8):
 *   - add a source / copy its URL → the rack's + (Add picker, with a Copy button)
 *   - layout style settings       → the stage's Style section
 *   - reveal-animation toggle      → the stage's "On show" row
 *   - controller subprocess        → the controller element's stage body
 *   - preview                      → the stage's preview column
 * so the browser and its helper modules (catalog / binding / layoutSettings /
 * controller / bracket-list) were deleted. What has no home on the console — the
 * GLOBAL design (colours, chrome, fonts, the design package, presets, branding)
 * — is what stays, and that is DesignTabBody.
 */
export default function DesignTab() {
    // The design previews iframe PRSH-served layouts, so they need the PRSH
    // origin, not the page's (in dev the app can run on Vite's port while the
    // server is on 5260). Any catalog URL is host-qualified for exactly that
    // reason, so we borrow the origin off one and fall back to the default port.
    const [baseUrl, setBaseUrl] = useState('http://localhost:5260');
    useEffect(() => {
        let alive = true;
        fetch('/api/v1/layouts')
            .then(r => (r.ok ? r.json() : []))
            .then(all => {
                if (!alive) return;
                const first = Array.isArray(all) && all.find(l => l?.url);
                if (first) {
                    try { setBaseUrl(new URL(first.url).origin); } catch { /* keep default */ }
                }
            })
            .catch(() => { /* keep default */ });
        return () => { alive = false; };
    }, []);

    return (
        <Stack gap="md">
            <DesignTabBody baseUrl={baseUrl} />
        </Stack>
    );
}
