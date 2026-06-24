import { Component, useEffect } from 'react';
import Providers from './providers';
import { useStoresLoaded } from '../context/store';
import { HashRouter } from 'react-router-dom';
import Root from '../routes/root';
import { TooltipProvider } from './ui/tooltip';
import { Toaster } from './ui/sonner';
import { Button } from './ui/button';
import { Loader } from './ui/primitives';
import { useSettingsStore } from '../context/store';

class ErrorBoundary extends Component {
    state = { error: null };

    static getDerivedStateFromError(error) {
        return { error };
    }

    render() {
        if (this.state.error) {
            return (
                <div className="flex h-screen items-center justify-center">
                    <div className="flex flex-col items-center gap-2 text-center">
                        <p className="text-lg font-bold">Something went wrong</p>
                        <p className="max-w-[400px] text-sm text-muted-foreground">
                            {this.state.error.message}
                        </p>
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                                this.setState({ error: null });
                                window.location.reload();
                            }}
                        >
                            Reload
                        </Button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

function LoadingScreen() {
    return (
        <div className="flex h-screen items-center justify-center">
            <div className="flex flex-col items-center gap-2">
                <Loader size="md" />
                <p className="text-sm text-muted-foreground">Connecting to server...</p>
            </div>
        </div>
    );
}

function AppInner() {
    const loaded = useStoresLoaded();
    // Project Rio's design is dark-only. We keep the `ui.color_scheme`
    // setting for forward-compat, but force the night theme: the `dark`
    // class stays on <html> so the UI never flashes light.
    const scheme = useSettingsStore(state => state?.ui?.color_scheme) || 'dark';

    useEffect(() => {
        const root = document.documentElement;
        const useDark = scheme !== 'light';
        root.classList.toggle('dark', useDark);
    }, [scheme]);

    return (
        <TooltipProvider delayDuration={200}>
            <Toaster position="top-right" />
            <ErrorBoundary>
                <HashRouter>
                    <Providers>
                        { loaded ? <Root /> : <LoadingScreen /> }
                    </Providers>
                </HashRouter>
            </ErrorBoundary>
        </TooltipProvider>
    );
}

export default function App() {
    return <AppInner />;
}
