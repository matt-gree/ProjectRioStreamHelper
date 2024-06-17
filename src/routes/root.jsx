import { useState, useEffect } from 'react';
import { FormattedMessage } from 'react-intl';
import { useSocket } from '../context/socket';
import '../css/root.css';

export default function Root() {
  const [connected, setConnected] = useState(false);
  const socket = useSocket();

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
    }
    const onDisconnect = () => {
      setConnected(false);
    }
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    }
  }, [socket]);

  return (
    <>
      <h1>{connected ? 
        <FormattedMessage id="status.connected" /> : 
        <FormattedMessage id="status.not_connected" />
      }</h1>
    </>
  )
}