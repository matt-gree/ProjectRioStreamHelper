import { useState, useEffect } from 'react';
import { Settings } from 'lucide-react';
import { useConfigStore } from '../context/store';
import { useSocket } from '../context/socket';
import { Button } from './ui/button';
import { SimpleTooltip } from './ui/simple-tooltip';
import { Title } from './ui/primitives';
import SettingsModal from './SettingsModal';
import { PatreonIcon, YouTubeIcon } from './SupportLinks';

export default function TSHFields() {
    const app_name = useConfigStore(state => state.name);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [connected, setConnected] = useState(false);

    const socket = useSocket();

    useEffect(() => {
        setConnected(socket.connected);

        const onConnect = () => setConnected(true);
        const onDisconnect = () => setConnected(false);

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
        };
    }, [socket]);

    return (
        <div className="bg-night-950 px-5 pt-4 pb-3">
            <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <img src="/favicon.png" alt="" width={24} height={24} className="pixelated" />
                    <Title order={4}>{app_name || 'TSH'}</Title>
                </div>
                <div className="flex items-center gap-2">
                    <SimpleTooltip label={connected ? 'Connected to server' : 'Disconnected from server'}>
                        <span
                            className="size-2 rounded-full"
                            style={{ backgroundColor: connected ? '#22c55e' : '#ef4444' }}
                        />
                    </SimpleTooltip>
                    <SimpleTooltip label="Support Project Rio on Patreon">
                        <Button asChild variant="ghost" size="icon-sm">
                            <a href="https://www.patreon.com/projectrio" target="_blank" rel="noopener noreferrer">
                                <PatreonIcon size={15} />
                            </a>
                        </Button>
                    </SimpleTooltip>
                    <SimpleTooltip label="MattGree on YouTube">
                        <Button asChild variant="ghost" size="icon-sm">
                            <a href="https://www.youtube.com/@MattGree" target="_blank" rel="noopener noreferrer">
                                <YouTubeIcon size={15} />
                            </a>
                        </Button>
                    </SimpleTooltip>
                    <SimpleTooltip label="Settings">
                        <Button variant="ghost" size="icon-sm" onClick={() => setSettingsOpen(true)}>
                            <Settings size={16} />
                        </Button>
                    </SimpleTooltip>
                </div>
            </div>
            <SettingsModal opened={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </div>
    );
}
