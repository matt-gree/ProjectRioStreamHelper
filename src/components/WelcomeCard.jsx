import { useState, useEffect, useCallback } from 'react';
import {
    Paper, Stack, Group, Text, Title, Button, ActionIcon, Transition,
    ThemeIcon, Box, Anchor,
} from '@mantine/core';
import { useSettingsStore, useConfigStore } from '../context/store';

// Tiny inline icons so we don't pull in a new dep. Each takes a `color` prop.
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
function CloseIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    );
}
function SparkleIcon({ size = 20 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
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
                <Text size="sm" fw={600}>{title}</Text>
                <Text size="xs" c="dimmed">{children}</Text>
            </Box>
        </Group>
    );
}

export default function WelcomeCard() {
    const dismissed = useSettingsStore(s => s?.ui?.welcome_dismissed) === true;
    const challongeKey = useSettingsStore(s => s?.challonge?.api_key);
    const setItem = useSettingsStore(s => s.setItem);
    const appName = useConfigStore(s => s.name) || 'PRSH';
    const version = useConfigStore(s => s.version);

    const [hudResolved, setHudResolved] = useState(null);
    const [mounted, setMounted] = useState(false);

    const challongeConfigured = !!(challongeKey && String(challongeKey).trim());

    // Check HUD state once on mount so the checklist reflects reality.
    useEffect(() => {
        if (dismissed) return;
        let alive = true;
        (async () => {
            try {
                const r = await fetch('/api/v1/rio/hud-path');
                const d = await r.json();
                if (alive) setHudResolved(!!d.resolved);
            } catch { /* ignore */ }
        })();
        return () => { alive = false; };
    }, [dismissed]);

    // Trigger the entrance animation one tick after render so Transition sees
    // mounted=false → true and plays the effect.
    useEffect(() => {
        if (dismissed) return;
        const id = requestAnimationFrame(() => setMounted(true));
        return () => cancelAnimationFrame(id);
    }, [dismissed]);

    const handleDismiss = useCallback(() => {
        // Animate out first, then persist so the user sees the collapse.
        setMounted(false);
        setTimeout(() => setItem('ui.welcome_dismissed', true), 250);
    }, [setItem]);

    if (dismissed) return null;

    return (
        <Transition mounted={mounted} transition="pop" duration={400} timingFunction="cubic-bezier(0.34, 1.56, 0.64, 1)">
            {(styles) => (
                <Paper
                    shadow="md"
                    radius="lg"
                    p="lg"
                    mx="md"
                    mb="md"
                    withBorder
                    style={{
                        ...styles,
                        position: 'relative',
                        overflow: 'hidden',
                        background: 'linear-gradient(135deg, var(--mantine-color-indigo-light) 0%, var(--mantine-color-grape-light) 100%)',
                    }}
                >
                    {/* Decorative animated orbs in the background */}
                    <Box
                        aria-hidden
                        style={{
                            position: 'absolute',
                            top: -60, right: -60, width: 200, height: 200,
                            borderRadius: '50%',
                            background: 'radial-gradient(circle, var(--mantine-color-indigo-4) 0%, transparent 70%)',
                            opacity: 0.5,
                            animation: 'prsh-welcome-float 7s ease-in-out infinite',
                            pointerEvents: 'none',
                        }}
                    />
                    <Box
                        aria-hidden
                        style={{
                            position: 'absolute',
                            bottom: -40, left: -40, width: 160, height: 160,
                            borderRadius: '50%',
                            background: 'radial-gradient(circle, var(--mantine-color-grape-4) 0%, transparent 70%)',
                            opacity: 0.45,
                            animation: 'prsh-welcome-float 9s ease-in-out infinite reverse',
                            pointerEvents: 'none',
                        }}
                    />

                    {/* Keyframes — scoped inline so the component is self-contained */}
                    <style>{`
                        @keyframes prsh-welcome-float {
                            0%, 100% { transform: translate(0, 0) scale(1); }
                            50% { transform: translate(12px, -8px) scale(1.08); }
                        }
                        @keyframes prsh-welcome-sparkle {
                            0%, 100% { transform: rotate(0deg) scale(1); opacity: 1; }
                            50% { transform: rotate(18deg) scale(1.15); opacity: 0.85; }
                        }
                    `}</style>

                    <ActionIcon
                        variant="subtle"
                        size="sm"
                        onClick={handleDismiss}
                        aria-label="Dismiss welcome"
                        style={{ position: 'absolute', top: 10, right: 10, zIndex: 2 }}
                    >
                        <CloseIcon />
                    </ActionIcon>

                    <Stack gap="md" style={{ position: 'relative', zIndex: 1 }}>
                        <Group gap="xs" align="center">
                            <ThemeIcon
                                size={36}
                                radius="xl"
                                variant="gradient"
                                gradient={{ from: 'indigo', to: 'grape', deg: 135 }}
                                style={{ animation: 'prsh-welcome-sparkle 3.5s ease-in-out infinite' }}
                            >
                                <SparkleIcon />
                            </ThemeIcon>
                            <Stack gap={0}>
                                <Title order={3}>Welcome to {appName}</Title>
                                {version && <Text size="xs" c="dimmed">v{version}</Text>}
                            </Stack>
                        </Group>

                        <Text size="sm">
                            Here's a quick checklist to get your stream overlay up and running.
                        </Text>

                        <Stack gap="xs">
                            <ChecklistRow done={hudResolved === true} title="Project Rio HUD file">
                                {hudResolved
                                    ? 'Found — game data will sync automatically.'
                                    : 'Not found yet. Open Settings → Project Rio to set the path.'}
                            </ChecklistRow>
                            <ChecklistRow done={false} title="Add OBS browser sources">
                                Browse the <Anchor component="a" href="#/layouts">Layouts tab</Anchor> to copy URLs for scoreboards, brackets, and more.
                            </ChecklistRow>
                            <ChecklistRow done={challongeConfigured} title="Tournament integration (optional)">
                                Load a bracket from Start.gg (public) or Challonge (API key in Settings).
                            </ChecklistRow>
                        </Stack>

                        <Group justify="flex-end" gap="xs">
                            <Button size="xs" variant="subtle" onClick={handleDismiss}>
                                Maybe later
                            </Button>
                            <Button
                                size="xs"
                                variant="gradient"
                                gradient={{ from: 'indigo', to: 'grape', deg: 135 }}
                                onClick={handleDismiss}
                            >
                                Got it
                            </Button>
                        </Group>
                    </Stack>
                </Paper>
            )}
        </Transition>
    );
}
