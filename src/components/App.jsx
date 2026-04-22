import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

import { Component } from 'react';
import Providers from './providers';
import { useStoresLoaded } from '../context/store';
import { HashRouter } from 'react-router-dom';
import Root from '../routes/root';
import { MantineProvider, Center, Loader, Stack, Text, Button } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { useSettingsStore } from '../context/store';

class ErrorBoundary extends Component {
    state = { error: null };

    static getDerivedStateFromError(error) {
        return { error };
    }

    render() {
        if (this.state.error) {
            return (
                <Center h="100vh">
                    <Stack align="center" gap="sm">
                        <Text size="lg" fw={700}>Something went wrong</Text>
                        <Text size="sm" c="dimmed" maw={400} ta="center">
                            {this.state.error.message}
                        </Text>
                        <Button
                            variant="light"
                            size="sm"
                            onClick={() => {
                                this.setState({ error: null });
                                window.location.reload();
                            }}
                        >
                            Reload
                        </Button>
                    </Stack>
                </Center>
            );
        }
        return this.props.children;
    }
}

function LoadingScreen() {
    return (
        <Center h="100vh">
            <Stack align="center" gap="sm">
                <Loader size="md" />
                <Text size="sm" c="dimmed">Connecting to server...</Text>
            </Stack>
        </Center>
    );
}

function AppInner() {
    const loaded = useStoresLoaded();
    // ui.color_scheme is one of "light" | "dark" | "auto". We only override
    // Mantine's "auto" (system) when the user picked a specific scheme.
    const scheme = useSettingsStore(state => state?.ui?.color_scheme) || 'auto';
    const forceColorScheme = scheme === 'auto' ? undefined : scheme;

    return (
        <MantineProvider defaultColorScheme="auto" forceColorScheme={forceColorScheme}>
            <Notifications position="top-right" autoClose={3000} />
            <ErrorBoundary>
                <HashRouter>
                    <Providers>
                        { loaded ? <Root /> : <LoadingScreen /> }
                    </Providers>
                </HashRouter>
            </ErrorBoundary>
        </MantineProvider>
    );
}

export default function App() {
    return <AppInner />;
}
