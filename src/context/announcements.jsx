import { useEffect, useRef } from 'react';
import { notifications } from '@mantine/notifications';
import { Anchor, Stack, Text } from '@mantine/core';
import { useSocket, useSocketSubscribe } from './socket';

const SEVERITY_COLORS = {
    info: 'blue',
    success: 'green',
    warn: 'yellow',
    warning: 'yellow',
    error: 'red',
    critical: 'red',
};

function renderAnnouncement(item) {
    return (
        <Stack gap={4}>
            {item.body && <Text size="sm">{item.body}</Text>}
            {item.link_url && (
                <Anchor
                    href={item.link_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    size="sm"
                    fw={500}
                >
                    {item.link_text || 'Open link'} →
                </Anchor>
            )}
        </Stack>
    );
}

export default function AnnouncementsListener() {
    const socket = useSocket();
    const shownRef = useRef(new Set());

    const show = (items) => {
        for (const item of items) {
            if (!item?.id || shownRef.current.has(item.id)) continue;
            shownRef.current.add(item.id);
            notifications.show({
                id: `announcement-${item.id}`,
                title: item.title,
                message: renderAnnouncement(item),
                color: SEVERITY_COLORS[item.severity] || 'blue',
                autoClose: false,
                withCloseButton: true,
                // Closing the toast only hides it for this session. Announcements
                // reappear on next app launch until the user clicks
                // "Clear announcements" in Settings or they expire.
            });
        }
    };

    useSocketSubscribe('v1.announcements.set', (payload) => {
        const items = payload?.items || [];
        // Hide any on-screen toasts no longer in the active list
        // (e.g. user clicked "Clear announcements" in Settings).
        const activeIds = new Set(items.map(i => i.id));
        for (const id of Array.from(shownRef.current)) {
            if (!activeIds.has(id)) {
                notifications.hide(`announcement-${id}`);
                shownRef.current.delete(id);
            }
        }
        show(items);
    });

    useEffect(() => {
        const fetchInitial = () => {
            socket.emit('v1.announcements.get', {}, (resp) => {
                if (resp?.items) show(resp.items);
            });
        };
        if (socket.connected) fetchInitial();
        else socket.once('connect', fetchInitial);
        return () => socket.off('connect', fetchInitial);
    }, [socket]);

    return null;
}
