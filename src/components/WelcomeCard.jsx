import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { Button } from './ui/button';
import { Anchor } from './ui/primitives';
import { useSettingsStore, useConfigStore } from '../context/store';
import { SupportLinks } from './SupportLinks';

// Tiny inline icons so we don't pull in a new dep.
function CheckIcon({ size = 14 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
        </svg>
    );
}
function DotIcon({ size = 10 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="12" r="6" />
        </svg>
    );
}
function ChecklistRow({ done, title, children }) {
    return (
        <div className="flex items-start gap-3">
            <span
                className="mt-0.5 flex size-[22px] shrink-0 items-center justify-center rounded-full"
                style={{
                    backgroundColor: done ? '#14b8a6' : 'rgba(255,255,255,0.15)',
                    color: done ? '#fff' : 'rgba(255,255,255,0.8)',
                }}
            >
                {done ? <CheckIcon /> : <DotIcon />}
            </span>
            <div className="flex-1">
                <p className="text-sm font-semibold text-white">{title}</p>
                <p className="text-xs" style={{ color: 'rgba(255,255,255,0.75)' }}>{children}</p>
            </div>
        </div>
    );
}

// One drifting, blurred Rio logo used as atmospheric background decoration.
function FloatLogo({ style }) {
    return (
        <div aria-hidden className="pointer-events-none absolute" style={style}>
            <img
                src="/favicon.png"
                alt=""
                className="size-full object-contain pixelated"
                style={style.imgStyle}
            />
        </div>
    );
}

export default function WelcomeCard() {
    const dismissed = useSettingsStore(s => s?.ui?.welcome_dismissed) === true;
    const settingsLoaded = useSettingsStore(s => s.loaded);
    const challongeKey = useSettingsStore(s => s?.challonge?.api_key);
    const setItem = useSettingsStore(s => s.setItem);
    const appName = useConfigStore(s => s.name) || 'PRSH';
    const version = useConfigStore(s => s.version);

    const [opened, setOpened] = useState(false);
    const [hudResolved, setHudResolved] = useState(null);
    const [assetsState, setAssetsState] = useState(null); // null | { complete, total_found, total_expected }

    const challongeConfigured = !!(challongeKey && String(challongeKey).trim());

    // Open once settings have loaded and the user hasn't dismissed before.
    useEffect(() => {
        if (settingsLoaded && !dismissed) {
            setOpened(true);
        }
    }, [settingsLoaded, dismissed]);

    // Check HUD + MSB assets state once the modal is opened.
    useEffect(() => {
        if (!opened) return;
        let alive = true;
        (async () => {
            try {
                const [hudR, assetsR] = await Promise.all([
                    fetch('/api/v1/rio/hud-path'),
                    fetch('/api/v1/assets/msb'),
                ]);
                const hudD = await hudR.json();
                const assetsD = await assetsR.json();
                if (alive) {
                    setHudResolved(!!hudD.resolved);
                    setAssetsState({
                        complete: !!assetsD.complete,
                        total_found: assetsD.total_found || 0,
                        total_expected: assetsD.total_expected || 0,
                    });
                }
            } catch { /* ignore */ }
        })();
        return () => { alive = false; };
    }, [opened]);

    const handleDismiss = useCallback(() => {
        setOpened(false);
        setItem('ui.welcome_dismissed', true);
    }, [setItem]);

    if (dismissed) return null;

    return (
        <Dialog open={opened} onOpenChange={(o) => { if (!o) handleDismiss(); }}>
            <DialogContent
                showCloseButton={false}
                className="max-w-lg overflow-hidden border-0 p-0"
            >
                <div
                    className="relative flex flex-col overflow-hidden px-7 pt-8 pb-6"
                    style={{
                        transform: 'translateZ(0)',
                        background: 'linear-gradient(135deg, #4a3236 0%, #8a3036 35%, #cc0010 70%, #e60012 100%)',
                    }}
                >
                    {/* Drifting, blurred Rio logos for atmosphere. */}
                    <FloatLogo style={{ top: -90, right: -90, width: 360, height: 360, animation: 'prsh-welcome-float-a 9s ease-in-out infinite', imgStyle: { opacity: 0.32, transform: 'rotate(-14deg)', filter: 'blur(7px)' } }} />
                    <FloatLogo style={{ bottom: -60, left: -60, width: 220, height: 220, animation: 'prsh-welcome-float-b 11s ease-in-out infinite', imgStyle: { opacity: 0.3, transform: 'rotate(22deg)', filter: 'blur(6px)' } }} />
                    <FloatLogo style={{ top: '35%', left: '72%', width: 130, height: 130, animation: 'prsh-welcome-float-a 13s ease-in-out infinite reverse', imgStyle: { opacity: 0.24, transform: 'rotate(-30deg)', filter: 'blur(9px)' } }} />
                    <FloatLogo style={{ bottom: '22%', right: '28%', width: 80, height: 80, animation: 'prsh-welcome-float-b 10s ease-in-out infinite reverse', imgStyle: { opacity: 0.28, transform: 'rotate(8deg)', filter: 'blur(5px)' } }} />
                    <FloatLogo style={{ top: '18%', left: '40%', width: 60, height: 60, animation: 'prsh-welcome-float-c 8s ease-in-out infinite', imgStyle: { opacity: 0.3, transform: 'rotate(-22deg)', filter: 'blur(3px)' } }} />
                    <FloatLogo style={{ top: '62%', left: '30%', width: 46, height: 46, animation: 'prsh-welcome-float-d 7s ease-in-out infinite reverse', imgStyle: { opacity: 0.32, transform: 'rotate(34deg)', filter: 'blur(2px)' } }} />
                    <FloatLogo style={{ top: '8%', right: '35%', width: 70, height: 70, animation: 'prsh-welcome-float-c 12s ease-in-out infinite reverse', imgStyle: { opacity: 0.26, transform: 'rotate(15deg)', filter: 'blur(4px)' } }} />

                    <style>{`
                        @keyframes prsh-welcome-float-a { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(-28px, 22px) scale(1.12); } }
                        @keyframes prsh-welcome-float-b { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(30px, -24px) scale(1.15); } }
                        @keyframes prsh-welcome-float-c { 0%, 100% { transform: translate(0, 0) scale(1); } 25% { transform: translate(18px, -14px) scale(1.08); } 50% { transform: translate(-22px, 10px) scale(0.92); } 75% { transform: translate(14px, 18px) scale(1.05); } }
                        @keyframes prsh-welcome-float-d { 0%, 100% { transform: translate(0, 0) scale(1); } 33% { transform: translate(-20px, -18px) scale(1.12); } 66% { transform: translate(24px, 14px) scale(0.94); } }
                        @keyframes prsh-welcome-sparkle { 0%, 100% { transform: rotate(0deg) scale(1); opacity: 1; } 50% { transform: rotate(18deg) scale(1.15); opacity: 0.85; } }
                    `}</style>

                    <div
                        className="relative z-[1] flex flex-col gap-4 rounded-[14px] px-6 py-[22px]"
                        style={{
                            background: 'rgba(20, 0, 6, 0.42)',
                            backdropFilter: 'blur(6px)',
                            WebkitBackdropFilter: 'blur(6px)',
                            border: '1px solid rgba(255, 255, 255, 0.12)',
                            boxShadow: '0 8px 30px rgba(0, 0, 0, 0.25)',
                        }}
                    >
                        <div className="flex items-center gap-3">
                            <img
                                src="/favicon.png"
                                alt=""
                                width={44}
                                height={44}
                                className="block pixelated"
                                style={{
                                    animation: 'prsh-welcome-sparkle 3.5s ease-in-out infinite',
                                    filter: 'drop-shadow(0 2px 6px rgba(0, 0, 0, 0.35))',
                                }}
                            />
                            <div className="flex flex-col">
                                <DialogTitle className="label-display text-lg text-white">Welcome to {appName}</DialogTitle>
                                {version && <span className="text-xs" style={{ color: 'rgba(255,255,255,0.7)' }}>v{version}</span>}
                            </div>
                        </div>

                        <p className="text-sm text-white">
                            Here's a quick checklist to get your stream overlay up and running.
                        </p>

                        <div className="flex flex-col gap-2 text-white">
                            <ChecklistRow done={assetsState?.complete === true} title="MSB image assets (required)">
                                {assetsState === null
                                    ? 'Checking…'
                                    : assetsState.complete
                                        ? `Complete (${assetsState.total_found} images) — overlays will render correctly.`
                                        : assetsState.total_found > 0
                                            ? `Incomplete (${assetsState.total_found}/${assetsState.total_expected}). Open Settings → Project Rio → MSB Image Assets to see what's missing.`
                                            : 'Not found. Open Settings → Project Rio → MSB Image Assets and click "Open Folder" to drop your image pack in.'}
                            </ChecklistRow>
                            <ChecklistRow done={hudResolved === true} title="Project Rio HUD file">
                                {hudResolved
                                    ? 'Found — game data will sync automatically.'
                                    : 'Not found yet. Open Settings → Project Rio to set the path.'}
                            </ChecklistRow>
                            <ChecklistRow done={false} title="Add OBS browser sources">
                                Browse the <Anchor href="#/layouts" onClick={handleDismiss} style={{ color: '#ffb3b8' }}>Layouts tab</Anchor> to copy URLs for scoreboards, brackets, and more.
                            </ChecklistRow>
                            <ChecklistRow done={challongeConfigured} title="Tournament integration (optional)">
                                Load a bracket from Start.gg (public) or Challonge (API key in Settings).
                            </ChecklistRow>
                        </div>

                        <div className="h-px w-full" style={{ background: 'rgba(255,255,255,0.18)' }} />

                        <SupportLinks className="text-white/80" />
                    </div>

                    <div className="relative z-[1] mt-4 flex justify-end">
                        <Button size="sm" onClick={handleDismiss}>
                            Got it
                        </Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
}
