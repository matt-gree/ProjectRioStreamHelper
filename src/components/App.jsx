import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';

import { Component } from 'react';
import Providers from './providers';
import { useStoresLoaded } from '../context/store';
import { HashRouter } from 'react-router-dom';
import Root from '../routes/root';
import { MantineProvider, Center, Loader, Stack, Text, Button } from '@mantine/core';
import { Notifications } from '@mantine/notifications';

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

export default function App() {
    const loaded = useStoresLoaded();

    return (
        <MantineProvider>
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
