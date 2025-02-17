import { createContext, useContext, useMemo, useEffect } from 'react';
import { io } from 'socket.io-client';
import { useStateStore, useSettingsStore, useConfigStore } from './store';

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
        const doSet = (resp) => {
            if("sid" in resp && resp.sid === socket.id) return;
            stateStore.setItem(resp.key, resp.value, false);
        }

        const doUnset = (resp) => {
            if("sid" in resp && resp.sid === socket.id) return;
            stateStore.deleteItem(resp.key, false);
        }

        if(!useStateStore.getState().loaded) {
            socket.emit('v1.state.get', {}, resp => {
                if('error' in resp) {
                    console.error(resp.error);
                    return;
                }
    
                stateStore.mergeItems(resp);
                socket.on('v1.state.set', doSet);
                socket.on('v1.state.unset', doUnset);
                stateStore.setLoaded(true);
            });
        } else {
            socket.on('v1.state.set', doSet);
            socket.on('v1.state.unset', doUnset);
        }

        return () => {
            socket.off('v1.state.set', doSet);
            socket.off('v1.state.unset', doUnset);
            stateStore.setLoaded(false);
        }
    }, [socket]);

    useEffect(() => {
        const doSet = (resp) => {
            if("sid" in resp && resp.sid === socket.id) return;
            settingsStore.setItem(resp.key, resp.value, false);
        }

        const doUnset = (resp) => {
            if("sid" in resp && resp.sid === socket.id) return;
            settingsStore.deleteItem(resp.key, false);
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

export const useSocketCallback = (...args) => new Promise((resolve, reject) => {
    const { socket } = useContext(SocketContext);
    if(!socket) {
        reject(new Error('Unknown error involving Socket.io context'));
        return;
    }

    try {
        socket.emit(...args, cb => {
            resolve(cb);
        });
    } catch(e) {
        reject(e);
    }
});