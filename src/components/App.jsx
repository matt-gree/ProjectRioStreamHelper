import '@mantine/core/styles.css';

import Providers from './providers';
import { useStoresLoaded } from '../context/store';
import { HashRouter } from 'react-router-dom';
import Root from '../routes/root';
import { MantineProvider } from '@mantine/core';

export default function App() {
    const loaded = useStoresLoaded();

    return (
        <MantineProvider>
            <HashRouter>
                <Providers>
                    { loaded ?
                    <Root />
                    :
                    <p>Loading...</p>
                    }
                </Providers>
            </HashRouter>
        </MantineProvider>
    )
}