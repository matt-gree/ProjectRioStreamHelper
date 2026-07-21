import { memo, useState, useMemo } from 'react';
import { Copy, Check } from 'lucide-react';
import { Loader } from '../../components/ui/primitives';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { SimpleTooltip } from '../../components/ui/simple-tooltip';
import { CopyButton } from '../../components/ui/copy-button';
import { cn } from '../../lib/utils';
import { notifications } from '../../lib/notify';
import { bindingForUrl } from '../../lib/obs-binding';
import { useObsStore } from '../../context/obs';

// Tinted-translucent source chips, matching the brand.
const SOURCE_COLORS = {
    hud: 'bg-[#22c55e]/15 text-[#4ade80]',
    api: 'bg-[#3b82f6]/15 text-[#60a5fa]',
    set: 'bg-[#a855f7]/15 text-[#c084fc]',
    manual: 'bg-muted text-muted-foreground',
};

// Friendly source labels (matches the Scoreboard tab's vocabulary).
const SOURCE_LABEL = { hud: 'HUD', api: 'API', set: 'Set', manual: 'Manual' };

// Derive the badge key from a scoreboard's transport + binding (mirrors the
// Scoreboard tab). Empty single boards read as "manual".
function bindingBadgeKey({ transport, mode, gameId }) {
    if (transport === 'hud') return 'hud';
    if (mode === 'rotate') return 'set';
    if (mode === 'single' && gameId != null) return 'api';
    return 'manual';
}

const CopyIconButton = memo(function CopyIconButton({ value }) {
    return (
        <CopyButton value={value}>
            {({ copied, copy }) => (
                <SimpleTooltip label={copied ? 'Copied!' : 'Copy URL'}>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        className={copied ? 'text-[#14b8a6]' : ''}
                        onClick={(e) => { e.stopPropagation(); copy(); }}
                    >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                    </Button>
                </SimpleTooltip>
            )}
        </CopyButton>
    );
});

// Live OBS binding for a layout URL — drives the status dot/badge and the
// Add-to-OBS button. Recomputes as OBS scene state changes.
function useLayoutBinding(url) {
    const status = useObsStore(s => s.status);
    const programScene = useObsStore(s => s.programScene);
    const previewScene = useObsStore(s => s.previewScene);
    const sceneItems = useObsStore(s => s.sceneItems);
    return useMemo(() => {
        if (status !== 'connected') return { state: 'offline', matches: [] };
        if (!url) return { state: 'absent', matches: [] };
        return bindingForUrl(url, { sceneItems, programScene, previewScene });
    }, [status, url, sceneItems, programScene, previewScene]);
}

const BINDING_TONE = {
    live: { dot: '#22c55e', badge: 'bg-[#22c55e]/15 text-[#4ade80]' },
    preview: { dot: '#f59e0b', badge: 'bg-[#f59e0b]/15 text-[#fbbf24]' },
    absent: { dot: '#3f3f46', badge: 'bg-muted text-muted-foreground' },
};

function bindingLabel(binding) {
    switch (binding.state) {
        case 'live': return `In OBS as “${binding.sourceName}” · program scene`;
        case 'preview': return `In OBS as “${binding.sourceName}” · preview scene`;
        case 'absent': return 'Not in OBS yet';
        default: return '';
    }
}

// Small glanceable dot for list rows. Hidden when OBS isn't connected.
const BindingDot = memo(function BindingDot({ binding }) {
    if (!binding || binding.state === 'offline') return null;
    const tone = BINDING_TONE[binding.state] || BINDING_TONE.absent;
    return (
        <SimpleTooltip label={bindingLabel(binding)}>
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: tone.dot }} />
        </SimpleTooltip>
    );
});

// Binding status + one-click "Add to OBS" for the previewed layout.
const ObsBindingControls = memo(function ObsBindingControls({ url, name, width, height }) {
    const binding = useLayoutBinding(url);
    const status = useObsStore(s => s.status);
    const programScene = useObsStore(s => s.programScene);
    const [adding, setAdding] = useState(false);

    if (status !== 'connected') {
        return (
            <SimpleTooltip label="Connect OBS in Settings to wire sources automatically">
                <Badge className="bg-muted text-[10px] text-muted-foreground">OBS offline</Badge>
            </SimpleTooltip>
        );
    }

    if (binding.state === 'live' || binding.state === 'preview') {
        const tone = BINDING_TONE[binding.state];
        return (
            <SimpleTooltip label={bindingLabel(binding)}>
                <Badge className={cn('text-[10px]', tone.badge)}>✓ {binding.sourceName}</Badge>
            </SimpleTooltip>
        );
    }

    const handleAdd = async () => {
        setAdding(true);
        try {
            const res = await useObsStore.getState().addBrowserSource({ inputName: name, url, width, height });
            notifications.show({ message: `Added “${res.inputName}” to ${res.sceneName}`, color: 'green' });
        } catch (e) {
            notifications.show({ message: e.message || 'Failed to add to OBS', color: 'red' });
        }
        setAdding(false);
    };

    return (
        <SimpleTooltip label={programScene ? `Add to program scene “${programScene}”` : 'No program scene in OBS'}>
            <Button variant="secondary" size="xs" onClick={handleAdd} disabled={adding || !programScene}>
                {adding && <Loader size={10} />} Add to OBS
            </Button>
        </SimpleTooltip>
    );
});

export { bindingBadgeKey, SOURCE_COLORS, SOURCE_LABEL, CopyIconButton, useLayoutBinding, BindingDot, ObsBindingControls };
