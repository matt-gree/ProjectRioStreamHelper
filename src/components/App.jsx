import { RouterProvider } from 'react-router-dom';
import { IntlProvider } from 'react-intl';
import { useSettingsStore } from '../context/store';
import { SocketProvider } from '../context/socket';
import { router } from './router';
import { locales } from '../lang/locales';

export default function App() {
    const locale = useSettingsStore(state => state.lang);
    const usersLocale = locale ? locale : 'en-US';

    return (
        <SocketProvider>
            <IntlProvider 
                locale={usersLocale}
                messages={locales[usersLocale].messages}
            >
                <RouterProvider router={router} />
            </IntlProvider>
        </SocketProvider>
    )
}