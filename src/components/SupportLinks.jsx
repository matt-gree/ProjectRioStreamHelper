import { Group, Text, Anchor } from '@mantine/core';

export function PatreonIcon({ size = 16, color = 'currentColor' }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden>
            <path d="M14.82 2.41C10.9 2.41 7.72 5.6 7.72 9.52c0 3.9 3.18 7.08 7.1 7.08 3.91 0 7.1-3.18 7.1-7.08 0-3.92-3.19-7.11-7.1-7.11zM2.18 21.59h3.5V2.41H2.18v19.18z" />
        </svg>
    );
}

export function YouTubeIcon({ size = 16, color = 'currentColor' }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden>
            <path d="M23.5 6.19a3.02 3.02 0 0 0-2.12-2.14C19.52 3.6 12 3.6 12 3.6s-7.52 0-9.38.45A3.02 3.02 0 0 0 .5 6.19C.06 8.07 0 12 0 12s.06 3.93.5 5.81A3.02 3.02 0 0 0 2.62 20c1.86.45 9.38.45 9.38.45s7.52 0 9.38-.45a3.02 3.02 0 0 0 2.12-2.14c.44-1.88.5-5.81.5-5.81s-.06-3.93-.5-5.81zM9.75 15.52V8.48L15.88 12l-6.13 3.52z" />
        </svg>
    );
}

export function SupportLinks({ size = 'xs', gap = 'lg', justify = 'center', style }) {
    return (
        <Group gap={gap} justify={justify} style={style}>
            <Anchor
                href="https://www.patreon.com/projectrio"
                target="_blank"
                rel="noopener noreferrer"
                underline="hover"
            >
                <Group gap={5} align="center" wrap="nowrap">
                    <PatreonIcon size={13} />
                    <Text size={size} span>Support Project Rio on Patreon</Text>
                </Group>
            </Anchor>
            <Anchor
                href="https://www.youtube.com/@MattGree"
                target="_blank"
                rel="noopener noreferrer"
                underline="hover"
            >
                <Group gap={5} align="center" wrap="nowrap">
                    <YouTubeIcon size={13} />
                    <Text size={size} span>MattGree on YouTube</Text>
                </Group>
            </Anchor>
        </Group>
    );
}
