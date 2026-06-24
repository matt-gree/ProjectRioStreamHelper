import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { Anchor, Stack, Text } from '../components/ui/primitives';
import { useSocket, useSocketSubscribe } from './socket';

// Maps a severity to the matching sonner toast variant.
const SEVERITY_VARIANT = {
    info: 'info',
    success: 'success',
    warn: 'warning',
    warning: 'warning',
    error: 'error',
    critical: 'error',
};

function renderAnnouncement(item) {
    return (
        <Stack gap="xs">
            {item.body && <Text size="sm">{item.body}</Text>}
            {item.link_url && (
                <Anchor
                    href={item.link_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium"
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
            const variant = SEVERITY_VARIANT[item.severity] || 'info';
            // Closing the toast only hides it for this session. Announcements
            // reappear on next app launch until the user clicks
            // "Clear announcements" in Settings or they expire.
            toast[variant](item.title, {
                id: `announcement-${item.id}`,
                description: renderAnnouncement(item),
                duration: Infinity,
                closeButton: true,
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
                toast.dismiss(`announcement-${id}`);
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
