import { SocketProvider } from '../context/socket';
import AnnouncementsListener from '../context/announcements';
import { ObsConnectionManager } from '../context/obs';

export default function Providers({ children }) {
    return (
        <SocketProvider>
            <AnnouncementsListener />
            <ObsConnectionManager />
            {children}
        </SocketProvider>
    )
}