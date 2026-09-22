import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { useConfigStore } from '../context/store';
import { useSocket } from '../context/socket';
import { Button } from './ui/button';
import { SimpleTooltip } from './ui/simple-tooltip';
import { Title } from './ui/primitives';
import { cn } from '../lib/utils';
import SettingsModal from './SettingsModal';
import { PatreonIcon, YouTubeIcon } from './SupportLinks';

export default function AppHeader({ tabs = [] }) {
    const app_name = useConfigStore(state => state.name);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [connected, setConnected] = useState(false);
    const location = useLocation();

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
        // No solid fill here so the body's red arena gradient (body::before)
        // bleeds all the way to the top of the page.
        <div className="px-5 pt-4">
            {/* One top row: app name (left), nav tabs (centered), actions (right). */}
            <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-4 border-b border-border">
                {/*
                    THE MARK IS `PRSH`, WITH THE FULL NAME UNDER IT.
                    `ProjectRioStreamHelper` set as one run-together 22-character
                    all-caps word is a string, not a wordmark — nothing in it
                    tells the eye where the words break, and it was the widest
                    thing in a header whose middle column has to hold five tabs.
                    PRSH is what this app is called in every file of its own
                    source; the expansion rides beneath so the name is still
                    stated, at a size that suits a thing you read once.

                    The fallback was `TSH` — the UPSTREAM project's initials,
                    which is what a fork shows when its own config fails to
                    load. It is the one moment the header is read closely.
                */}
                <div className="flex items-center gap-2.5 pb-3">
                    <img src="/favicon.png" alt="" width={26} height={26} className="pixelated" />
                    <div className="flex min-w-0 flex-col leading-none">
                        <Title order={4} className="leading-none">PRSH</Title>
                        <span className="label-display truncate text-[10px] leading-none tracking-wide text-muted-foreground">
                            {app_name || 'ProjectRioStreamHelper'}
                        </span>
                    </div>
                </div>
                {/* Rio nav: Rajdhani labels, rio-red active underline aligned to the row border. */}
                <nav className="flex items-end gap-1">
                    {tabs.map(tab => {
                        const active = location.pathname === tab.path;
                        return (
                            <Link
                                key={tab.path}
                                to={tab.path}
                                className={cn(
                                    "label-display border-b-2 px-4 py-3 text-sm transition-colors",
                                    active
                                        ? "border-rio-500 text-foreground"
                                        : "border-transparent text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {tab.name}
                            </Link>
                        );
                    })}
                </nav>
                <div className="flex items-center justify-self-end gap-2 pb-3">
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
