//import { useState, useEffect } from 'react';
import { FormattedMessage } from 'react-intl';
//import { useSocket } from '../context/socket';

import TSHFields from './fields';

export default function Root() {
//  const [connected, setConnected] = useState(false);
//  const socket = useSocket();

//  useEffect(() => {
//    const onConnect = () => {
//      setConnected(true);
//    }
//    const onDisconnect = () => {
//      setConnected(false);
//    }
//    socket.on('connect', onConnect);
//    socket.on('disconnect', onDisconnect);

//    return () => {
//      socket.off('connect', onConnect);
//      socket.off('disconnect', onDisconnect);
//    }
//  }, [socket]);

  return (
    <div style={{ 
      position: 'absolute',
      margin: 0,
      padding: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      height: '100vh'
    }}>
      <TSHFields />
    </div>
  )
}