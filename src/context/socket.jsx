import { createContext, useContext, useMemo, useEffect } from 'react';
import { io } from 'socket.io-client';
import { useStateStore, useSettingsStore, useConfigStore, setSocketRef } from './store';

export const SocketContext = createContext({
    socket: null
});

export const SocketProvider = ({children}) => {
    const stateStore = useStateStore();
    const settingsStore = useSettingsStore();
    const configStore = useConfigStore();

    const socket = useMemo(
        () => io(
            (window.location.protocol === 'https' ? 'wss://' : 'ws://') + '' + window.location.host + '/', {
                transports: ['websocket'],
                autoConnect: false
            }),
            []
    );

    // Register the socket reference so Zustand store actions can emit
    useEffect(() => {
        setSocketRef(socket);
        return () => setSocketRef(null);
    }, [socket]);

    useEffect(() => {
        if(!socket.connected) {
            socket.connect();

            socket.on('error', err => {
                console.error('Socket.io event error', err);
            });
        }

        return () => {
            if(socket) {
                socket.removeAllListeners();
                socket.close();
            }
        }
    }, [socket]);

    useEffect(() => {
        // Batch incoming SocketIO events so rapid-fire updates
        // (e.g. swap teams) are applied in a single Zustand set().
        // We use requestAnimationFrame so all events arriving within
        // a single frame (~16ms) are flushed together before paint.
        let setPending = [];
        let unsetPending = [];
        let rafId = null;

        const flushState = () => {
            rafId = null;
            if (setPending.length > 0) {
                const batch = setPending;
                setPending = [];
                stateStore.setItems(batch, false);
            }
            if (unsetPending.length > 0) {
                const batch = unsetPending;
                unsetPending = [];
                stateStore.deleteItems(batch, false);
            }
        };

        const scheduleFlush = () => {
            if (rafId === null) {
                rafId = requestAnimationFrame(flushState);
            }
        };

        const doSet = (resp) => {
            if("sid" in resp && resp.sid === socket.id) return;
            setPending.push({ key: resp.key, value: resp.value });
            scheduleFlush();
        }

        const doBatchSet = (resp) => {
            if("sid" in resp && resp.sid === socket.id) return;
            if(resp.items && resp.items.length > 0) {
                for (const item of resp.items) {
                    setPending.push({ key: item.key, value: item.value });
                }
                scheduleFlush();
            }
        }

        const doUnset = (resp) => {
            if("sid" in resp && resp.sid === socket.id) return;
            unsetPending.push(resp.key);
            scheduleFlush();
        }

        if(!useStateStore.getState().loaded) {
            socket.emit('v1.state.get', {}, resp => {
                if('error' in resp) {
                    console.error(resp.error);
                    return;
                }

                stateStore.mergeItems(resp);
                socket.on('v1.state.set', doSet);
                socket.on('v1.state.set_batch', doBatchSet);
                socket.on('v1.state.unset', doUnset);
                stateStore.setLoaded(true);
            });
        } else {
            socket.on('v1.state.set', doSet);
            socket.on('v1.state.set_batch', doBatchSet);
            socket.on('v1.state.unset', doUnset);
        }

        return () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            socket.off('v1.state.set', doSet);
            socket.off('v1.state.set_batch', doBatchSet);
            socket.off('v1.state.unset', doUnset);
            stateStore.setLoaded(false);
        }
    }, [socket]);

    useEffect(() => {
        let setPending = [];
        let unsetPending = [];
        let rafId = null;

        const flushSettings = () => {
            rafId = null;
            if (setPending.length > 0) {
                const batch = setPending;
                setPending = [];
                for (const { key, value } of batch) {
                    settingsStore.setItem(key, value, false);
                }
            }
            if (unsetPending.length > 0) {
                const batch = unsetPending;
                unsetPending = [];
                for (const key of batch) {
                    settingsStore.deleteItem(key, false);
                }
            }
        };

        const scheduleFlush = () => {
            if (rafId === null) {
                rafId = requestAnimationFrame(flushSettings);
            }
        };

        const doSet = (resp) => {
            if("sid" in resp && resp.sid === socket.id) return;
            setPending.push({ key: resp.key, value: resp.value });
            scheduleFlush();
        }

        const doUnset = (resp) => {
            if("sid" in resp && resp.sid === socket.id) return;
            unsetPending.push(resp.key);
            scheduleFlush();
        }

        if(!useSettingsStore.getState().loaded) {
            socket.emit('v1.settings.get', {}, resp => {
                if('error' in resp) {
                    console.error(resp.error);
                    return;
                }

                settingsStore.mergeItems(resp);
                socket.on('v1.settings.set', doSet);
                socket.on('v1.settings.unset', doUnset);
                settingsStore.setLoaded(true);
            });
        } else {
            socket.on('v1.settings.set', doSet);
            socket.on('v1.settings.unset', doUnset);
        }

        return () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            socket.off('v1.settings.set', doSet);
            socket.off('v1.settings.unset', doUnset);
            settingsStore.setLoaded(false);
        }
    }, [socket]);

    useEffect(() => {
        if(useConfigStore.getState().loaded) return;

        socket.emit('v1.config.get', {}, resp => {
            if('error' in resp) {
                console.error(resp.error);
                return;
            }

            configStore.mergeItems(resp);
            configStore.setLoaded(true);
        });

        return () => {}
    }, [socket]);

    return (
        <SocketContext value={{ socket }}>
            {children}
        </SocketContext>
    )
}

export const useSocket = () => {
    const { socket } = useContext(SocketContext);
    if(!socket) {
        throw new Error('Unknown error involving Socket.io context');
    }
    return socket;
}

export const useSocketSubscribe = (eventName, eventHandler) => {
    const { socket } = useContext(SocketContext);
    if(!socket) {
        throw new Error('Unknown error involving Socket.io context');
    }

    useEffect(() => {
        socket.on(eventName, eventHandler);
        return () => {
            socket.off(eventName, eventHandler);
        }
    }, [eventHandler]);
}
