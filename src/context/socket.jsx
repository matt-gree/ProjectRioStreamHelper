import { createContext, useContext, useMemo, useEffect } from 'react';
import { io } from 'socket.io-client';

export const SocketContext = createContext({
    socket: null
});

export const SocketProvider = ({children}) => {
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

    return (
        <SocketContext.Provider value={{
            socket
        }}>
            {children}
        </SocketContext.Provider>
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