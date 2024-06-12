import { useState, useEffect } from 'react';
import { FormattedMessage } from 'react-intl';
import '../css/root.css';

export default function Root() {
  const [connected, setConnected] = useState(window.socket.connected);

  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
    }
    const onDisconnect = () => {
      setConnected(false);
    }
    window.socket.on('connect', onConnect);
    window.socket.on('disconnect', onDisconnect);

    return () => {
      window.socket.off('connect', onConnect);
      window.socket.off('disconnect', onDisconnect);
    }
  });

  return (
    <>
      <h1>{connected ? 
        <FormattedMessage id="status.connected" /> : 
        <FormattedMessage id="status.not_connected" />
      }</h1>
    </>
  )
}