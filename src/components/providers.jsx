import { IntlProvider } from 'react-intl';
import { locales } from '../lang/locales';
import { SocketProvider } from '../context/socket';
import { useSettingsStore } from '../context/store';

export default function Providers({ children }) {
    const locale = useSettingsStore(state => state.lang);
    const usersLocale = locale ? locale : 'en-US';

    return (
        <SocketProvider>
            <IntlProvider 
                locale={usersLocale}
                messages={locales[usersLocale].messages}
            >
                {children}
            </IntlProvider>
        </SocketProvider>
    )
}