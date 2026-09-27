import { SocketProvider } from '../context/socket';
import AnnouncementsListener from '../context/announcements';
import UpdateListener from '../context/updater';
import { ObsConnectionManager } from '../context/obs';

export default function Providers({ children }) {
    return (
        <SocketProvider>
            <AnnouncementsListener />
            <UpdateListener />
            <ObsConnectionManager />
            {children}
        </SocketProvider>
    )
}