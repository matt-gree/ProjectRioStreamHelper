import { IntlProvider } from 'react-intl';
import { locales } from '../lang/locales';
import { SocketProvider } from '../context/socket';
import AnnouncementsListener from '../context/announcements';
import { ObsConnectionManager } from '../context/obs';
import { useSettingsStore } from '../context/store';

export default function Providers({ children }) {
    const locale = useSettingsStore(state => state.lang);
    const usersLocale = locale ? locale : 'en-US';

    return (
        <SocketProvider>
            <AnnouncementsListener />
            <ObsConnectionManager />
            <IntlProvider
                locale={usersLocale}
                messages={locales[usersLocale].messages}
            >
                {children}
            </IntlProvider>
        </SocketProvider>
    )
}