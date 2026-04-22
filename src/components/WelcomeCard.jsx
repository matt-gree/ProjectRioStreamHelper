import { useState, useEffect, useCallback } from 'react';
import {
    Modal, Stack, Group, Text, Title, Button, ThemeIcon, Box, Anchor,
} from '@mantine/core';
import { useSettingsStore, useConfigStore } from '../context/store';

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
        <Group gap="sm" align="flex-start" wrap="nowrap">
            <ThemeIcon
                radius="xl"
                size={22}
                variant={done ? 'filled' : 'light'}
                color={done ? 'teal' : 'gray'}
            >
                {done ? <CheckIcon /> : <DotIcon />}
            </ThemeIcon>
            <Box style={{ flex: 1 }}>
                <Text size="sm" fw={600} c="white">{title}</Text>
                <Text size="xs" style={{ color: 'rgba(255,255,255,0.75)' }}>{children}</Text>
            </Box>
        </Group>
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

    const challongeConfigured = !!(challongeKey && String(challongeKey).trim());

    // Open once settings have loaded and the user hasn't dismissed before.
    useEffect(() => {
        if (settingsLoaded && !dismissed) {
            setOpened(true);
        }
    }, [settingsLoaded, dismissed]);

    // Check HUD state once the modal is opened.
    useEffect(() => {
        if (!opened) return;
        let alive = true;
        (async () => {
            try {
                const r = await fetch('/api/v1/rio/hud-path');
                const d = await r.json();
                if (alive) setHudResolved(!!d.resolved);
            } catch { /* ignore */ }
        })();
        return () => { alive = false; };
    }, [opened]);

    const handleDismiss = useCallback(() => {
        setOpened(false);
        // Persist after the whimsical close animation finishes so the
        // card doesn't re-mount-then-vanish on the next render.
        setTimeout(() => setItem('ui.welcome_dismissed', true), 520);
    }, [setItem]);

    if (dismissed) return null;

    return (
        <Modal
            opened={opened}
            onClose={handleDismiss}
            withCloseButton={false}
            centered
            size="lg"
            radius="lg"
            padding={0}
            overlayProps={{ backgroundOpacity: 0.6, blur: 4 }}
            // Custom transition: pops in with a springy overshoot, and on close
            // tumbles up and away with a shrink + tilt for a playful exit.
            transitionProps={{
                transition: {
                    in: { opacity: 1, transform: 'scale(1) rotate(0deg) translateY(0)' },
                    out: { opacity: 0, transform: 'scale(0.35) rotate(-14deg) translateY(-90px)' },
                    common: { transformOrigin: 'center center' },
                    transitionProperty: 'transform, opacity',
                },
                duration: 520,
                timingFunction: 'cubic-bezier(0.68, -0.55, 0.27, 1.55)',
            }}
            styles={{
                body: { padding: 0 },
            }}
        >
            <Box
                style={{
                    position: 'relative',
                    overflow: 'hidden',
                    // Fixed gradient stops (not theme-aware) so the card looks
                    // identical in light and dark mode. Start with a neutral
                    // dark grey at the top-left (matching the dark-mode
                    // previous look) and fade to the bright red-6 at the
                    // bottom-right.
                    background: 'linear-gradient(135deg, #4a3236 0%, #8a3036 35%, var(--mantine-color-red-7) 70%, var(--mantine-color-red-5) 100%)',
                    padding: '32px 28px 24px',
                    display: 'flex',
                    flexDirection: 'column',
                }}
            >
                {/* Blurred, drifting Rio logos used as atmospheric background
                    decoration. Wrapper Box handles the drift animation (so
                    transform: translate/scale on keyframes doesn't clobber
                    the inner rotation). aria-hidden + pointerEvents: none so
                    they don't interfere with interaction or screen readers. */}
                {/* Blurred, drifting Rio logos used as atmospheric background
                    decoration. Wrapper Box handles the drift animation (so
                    transform: translate/scale on keyframes doesn't clobber
                    the inner rotation). Four sizes for visual rhythm.
                    aria-hidden + pointerEvents: none so they don't interfere
                    with interaction or screen readers. */}
                <Box
                    aria-hidden
                    style={{
                        position: 'absolute',
                        top: -90, right: -90, width: 360, height: 360,
                        animation: 'prsh-welcome-float-a 9s ease-in-out infinite',
                        pointerEvents: 'none',
                        willChange: 'transform',
                    }}
                >
                    <img
                        src="/favicon.png"
                        alt=""
                        style={{
                            width: '100%', height: '100%',
                            objectFit: 'contain',
                            opacity: 0.32,
                            transform: 'rotate(-14deg)',
                            filter: 'blur(7px)',
                        }}
                    />
                </Box>
                <Box
                    aria-hidden
                    style={{
                        position: 'absolute',
                        bottom: -60, left: -60, width: 220, height: 220,
                        animation: 'prsh-welcome-float-b 11s ease-in-out infinite',
                        pointerEvents: 'none',
                        willChange: 'transform',
                    }}
                >
                    <img
                        src="/favicon.png"
                        alt=""
                        style={{
                            width: '100%', height: '100%',
                            objectFit: 'contain',
                            opacity: 0.3,
                            transform: 'rotate(22deg)',
                            filter: 'blur(6px)',
                        }}
                    />
                </Box>
                <Box
                    aria-hidden
                    style={{
                        position: 'absolute',
                        top: '35%', left: '72%', width: 130, height: 130,
                        animation: 'prsh-welcome-float-a 13s ease-in-out infinite reverse',
                        pointerEvents: 'none',
                        willChange: 'transform',
                    }}
                >
                    <img
                        src="/favicon.png"
                        alt=""
                        style={{
                            width: '100%', height: '100%',
                            objectFit: 'contain',
                            opacity: 0.24,
                            transform: 'rotate(-30deg)',
                            filter: 'blur(9px)',
                        }}
                    />
                </Box>
                <Box
                    aria-hidden
                    style={{
                        position: 'absolute',
                        bottom: '22%', right: '28%', width: 80, height: 80,
                        animation: 'prsh-welcome-float-b 10s ease-in-out infinite reverse',
                        pointerEvents: 'none',
                        willChange: 'transform',
                    }}
                >
                    <img
                        src="/favicon.png"
                        alt=""
                        style={{
                            width: '100%', height: '100%',
                            objectFit: 'contain',
                            opacity: 0.28,
                            transform: 'rotate(8deg)',
                            filter: 'blur(5px)',
                        }}
                    />
                </Box>

                {/* Small, more-mobile drift ornaments. Larger translate deltas
                    in float-c/d keyframes below so these read as livelier. */}
                <Box
                    aria-hidden
                    style={{
                        position: 'absolute',
                        top: '18%', left: '40%', width: 60, height: 60,
                        animation: 'prsh-welcome-float-c 8s ease-in-out infinite',
                        pointerEvents: 'none',
                        willChange: 'transform',
                    }}
                >
                    <img
                        src="/favicon.png"
                        alt=""
                        style={{
                            width: '100%', height: '100%',
                            objectFit: 'contain',
                            opacity: 0.3,
                            transform: 'rotate(-22deg)',
                            filter: 'blur(3px)',
                        }}
                    />
                </Box>
                <Box
                    aria-hidden
                    style={{
                        position: 'absolute',
                        top: '62%', left: '30%', width: 46, height: 46,
                        animation: 'prsh-welcome-float-d 7s ease-in-out infinite reverse',
                        pointerEvents: 'none',
                        willChange: 'transform',
                    }}
                >
                    <img
                        src="/favicon.png"
                        alt=""
                        style={{
                            width: '100%', height: '100%',
                            objectFit: 'contain',
                            opacity: 0.32,
                            transform: 'rotate(34deg)',
                            filter: 'blur(2px)',
                        }}
                    />
                </Box>
                <Box
                    aria-hidden
                    style={{
                        position: 'absolute',
                        top: '8%', right: '35%', width: 70, height: 70,
                        animation: 'prsh-welcome-float-c 12s ease-in-out infinite reverse',
                        pointerEvents: 'none',
                        willChange: 'transform',
                    }}
                >
                    <img
                        src="/favicon.png"
                        alt=""
                        style={{
                            width: '100%', height: '100%',
                            objectFit: 'contain',
                            opacity: 0.26,
                            transform: 'rotate(15deg)',
                            filter: 'blur(4px)',
                        }}
                    />
                </Box>
                {/* Keyframes — scoped inline so the component is self-contained.
                    Bigger translate deltas than the first pass so the motion is
                    clearly visible against the gradient. */}
                <style>{`
                    @keyframes prsh-welcome-float-a {
                        0%, 100% { transform: translate(0, 0) scale(1); }
                        50% { transform: translate(-28px, 22px) scale(1.12); }
                    }
                    @keyframes prsh-welcome-float-b {
                        0%, 100% { transform: translate(0, 0) scale(1); }
                        50% { transform: translate(30px, -24px) scale(1.15); }
                    }
                    /* Bigger excursions for the smaller ornaments so they
                       read as lively rather than merely ambient. */
                    @keyframes prsh-welcome-float-c {
                        0%, 100% { transform: translate(0, 0) scale(1); }
                        25% { transform: translate(18px, -14px) scale(1.08); }
                        50% { transform: translate(-22px, 10px) scale(0.92); }
                        75% { transform: translate(14px, 18px) scale(1.05); }
                    }
                    @keyframes prsh-welcome-float-d {
                        0%, 100% { transform: translate(0, 0) scale(1); }
                        33% { transform: translate(-20px, -18px) scale(1.12); }
                        66% { transform: translate(24px, 14px) scale(0.94); }
                    }
                    @keyframes prsh-welcome-sparkle {
                        0%, 100% { transform: rotate(0deg) scale(1); opacity: 1; }
                        50% { transform: rotate(18deg) scale(1.15); opacity: 0.85; }
                    }
                `}</style>

                <Stack
                    gap="md"
                    style={{
                        position: 'relative',
                        zIndex: 1,
                        // Semi-opaque dark panel that sits over the drifting
                        // logos so the text and checklist always have solid
                        // contrast regardless of what's floating behind.
                        background: 'rgba(20, 0, 6, 0.42)',
                        backdropFilter: 'blur(6px)',
                        WebkitBackdropFilter: 'blur(6px)',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        borderRadius: 14,
                        padding: '22px 24px',
                        boxShadow: '0 8px 30px rgba(0, 0, 0, 0.25)',
                    }}
                >
                    <Group gap="sm" align="center">
                        <img
                            src="/favicon.png"
                            alt=""
                            width={44}
                            height={44}
                            style={{
                                display: 'block',
                                animation: 'prsh-welcome-sparkle 3.5s ease-in-out infinite',
                                filter: 'drop-shadow(0 2px 6px rgba(0, 0, 0, 0.35))',
                            }}
                        />
                        <Stack gap={0}>
                            <Title order={3} c="white">Welcome to {appName}</Title>
                            {version && <Text size="xs" style={{ color: 'rgba(255,255,255,0.7)' }}>v{version}</Text>}
                        </Stack>
                    </Group>

                    <Text size="sm" c="white">
                        Here's a quick checklist to get your stream overlay up and running.
                    </Text>

                    <Stack gap="xs" style={{ color: 'white' }}>
                        <ChecklistRow done={hudResolved === true} title="Project Rio HUD file">
                            {hudResolved
                                ? 'Found — game data will sync automatically.'
                                : 'Not found yet. Open Settings → Project Rio to set the path.'}
                        </ChecklistRow>
                        <ChecklistRow done={false} title="Add OBS browser sources">
                            Browse the <Anchor component="a" href="#/layouts" onClick={handleDismiss} style={{ color: 'var(--mantine-color-red-2)' }}>Layouts tab</Anchor> to copy URLs for scoreboards, brackets, and more.
                        </ChecklistRow>
                        <ChecklistRow done={challongeConfigured} title="Tournament integration (optional)">
                            Load a bracket from Start.gg (public) or Challonge (API key in Settings).
                        </ChecklistRow>
                    </Stack>

                </Stack>

                {/* CTA sits on the outer gradient (outside the higher
                    contrast panel) so it feels like a floating action. */}
                <Group
                    justify="flex-end"
                    gap="xs"
                    style={{ position: 'relative', zIndex: 1, marginTop: 16 }}
                >
                    <Button
                        size="sm"
                        variant="gradient"
                        gradient={{ from: 'red', to: 'pink', deg: 135 }}
                        onClick={handleDismiss}
                    >
                        Got it
                    </Button>
                </Group>
            </Box>
        </Modal>
    );
}
