import { createContext, useContext, useMemo, useEffect } from 'react';
import { io } from 'socket.io-client';
import { useStateStore, useSettingsStore, useConfigStore, setSocketRef } from './store';

export const SocketContext = createContext({
    socket: null
});

export const SocketProvider = ({children}) => {

    const socket = useMemo(
        () => io(
            (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + '' + window.location.host + '/', {
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
        //
        // ONE ordered queue, not a set list and an unset list. Applying every
        // pending set and only then every pending unset reorders the two
        // against each other, and the server's order is the true one: an
        // unset of a subtree followed by a write back into it (board and match
        // ids are reused, so this is routine) came out backwards and the key
        // vanished from a client the server considers current.
        let pending = [];
        let rafId = null;
        // Nothing may be applied before the v1.state.get snapshot has been
        // merged, or the snapshot would land on top of newer pushes and undo
        // them. Buffering instead of dropping is the whole point: the snapshot
        // is a round trip, and PRSH pushes throughout it.
        let ready = false;
        let cancelled = false;

        const flushState = () => {
            rafId = null;
            if (!ready || pending.length === 0) return;
            const ops = pending;
            pending = [];
            const store = useStateStore.getState();
            // Runs of one kind still collapse into a single store update, so
            // the batching contract survives: N sets in a frame is one set().
            let i = 0;
            while (i < ops.length) {
                const kind = ops[i].kind;
                const run = [];
                while (i < ops.length && ops[i].kind === kind) run.push(ops[i++]);
                if (kind === 'set') {
                    store.setItems(run.map(o => ({ key: o.key, value: o.value })), false);
                } else {
                    store.deleteItems(run.map(o => o.key), false);
                }
            }
        };

        const scheduleFlush = () => {
            if (rafId === null) {
                rafId = requestAnimationFrame(flushState);
            }
        };

        const doSet = (resp) => {
            if("sid" in resp && resp.sid === socket.id) return;
            pending.push({ kind: 'set', key: resp.key, value: resp.value });
            scheduleFlush();
        }

        const doBatchSet = (resp) => {
            if("sid" in resp && resp.sid === socket.id) return;
            if(resp.items && resp.items.length > 0) {
                for (const item of resp.items) {
                    pending.push({ kind: 'set', key: item.key, value: item.value });
                }
                scheduleFlush();
            }
        }

        const doUnset = (resp) => {
            if("sid" in resp && resp.sid === socket.id) return;
            pending.push({ kind: 'unset', key: resp.key });
            scheduleFlush();
        }

        const doBatchUnset = (resp) => {
            if("sid" in resp && resp.sid === socket.id) return;
            if(resp.items && resp.items.length > 0) {
                for (const item of resp.items) {
                    pending.push({ kind: 'unset', key: item.key });
                }
                scheduleFlush();
            }
        }

        // Listen BEFORE asking. Registering inside the response callback left a
        // window the length of a round trip in which every push was dropped —
        // on a busy key the next HUD frame papered over it, on a rarely-written
        // one (a match binding, a container feed) it stayed wrong until someone
        // touched it again.
        socket.on('v1.state.set', doSet);
        socket.on('v1.state.set_batch', doBatchSet);
        socket.on('v1.state.unset', doUnset);
        socket.on('v1.state.unset_batch', doBatchUnset);

        if(!useStateStore.getState().loaded) {
            socket.emit('v1.state.get', {}, resp => {
                // A response that outlives the provider must not write to a
                // store it has already let go of.
                if(cancelled) return;
                if('error' in resp) {
                    console.error(resp.error);
                    pending = [];   // no snapshot: don't grow a buffer forever
                    return;
                }

                useStateStore.getState().mergeItems(resp);
                ready = true;
                useStateStore.getState().setLoaded(true);
                flushState();       // replay whatever arrived during the trip
            });
        } else {
            ready = true;
        }

        return () => {
            cancelled = true;
            if (rafId !== null) cancelAnimationFrame(rafId);
            socket.off('v1.state.set', doSet);
            socket.off('v1.state.set_batch', doBatchSet);
            socket.off('v1.state.unset', doUnset);
            socket.off('v1.state.unset_batch', doBatchUnset);
            useStateStore.getState().setLoaded(false);
        }
    }, [socket]);

    // Same shape as the state channel above, and for the same reasons: one
    // ordered queue, listeners registered before the snapshot is asked for,
    // nothing applied until it has been merged.
    useEffect(() => {
        let pending = [];
        let rafId = null;
        let ready = false;
        let cancelled = false;

        const flushSettings = () => {
            rafId = null;
            if (!ready || pending.length === 0) return;
            const ops = pending;
            pending = [];
            const store = useSettingsStore.getState();
            for (const op of ops) {
                if (op.kind === 'set') store.setItem(op.key, op.value, false);
                else store.deleteItem(op.key, false);
            }
        };

        const scheduleFlush = () => {
            if (rafId === null) {
                rafId = requestAnimationFrame(flushSettings);
            }
        };

        const doSet = (resp) => {
            if("sid" in resp && resp.sid === socket.id) return;
            pending.push({ kind: 'set', key: resp.key, value: resp.value });
            scheduleFlush();
        }

        const doUnset = (resp) => {
            if("sid" in resp && resp.sid === socket.id) return;
            pending.push({ kind: 'unset', key: resp.key });
            scheduleFlush();
        }

        socket.on('v1.settings.set', doSet);
        socket.on('v1.settings.unset', doUnset);

        if(!useSettingsStore.getState().loaded) {
            socket.emit('v1.settings.get', {}, resp => {
                if(cancelled) return;
                if('error' in resp) {
                    console.error(resp.error);
                    pending = [];
                    return;
                }

                useSettingsStore.getState().mergeItems(resp);
                ready = true;
                useSettingsStore.getState().setLoaded(true);
                flushSettings();
            });
        } else {
            ready = true;
        }

        return () => {
            cancelled = true;
            if (rafId !== null) cancelAnimationFrame(rafId);
            socket.off('v1.settings.set', doSet);
            socket.off('v1.settings.unset', doUnset);
            useSettingsStore.getState().setLoaded(false);
        }
    }, [socket]);

    useEffect(() => {
        if(useConfigStore.getState().loaded) return;
        let cancelled = false;

        socket.emit('v1.config.get', {}, resp => {
            if(cancelled) return;
            if('error' in resp) {
                console.error(resp.error);
                return;
            }

            useConfigStore.getState().mergeItems(resp);
            useConfigStore.getState().setLoaded(true);
        });

        return () => { cancelled = true; }
    }, [socket]);

    const socketValue = useMemo(() => ({ socket }), [socket]);

    return (
        <SocketContext value={socketValue}>
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
    }, [socket, eventName, eventHandler]);
}
