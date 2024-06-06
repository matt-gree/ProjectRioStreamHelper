import 'vite/modulepreload-polyfill';
import React from 'react'
import ReactDOM from 'react-dom/client';
import { io } from 'socket.io-client';
import App from './components/App';

window.socket = io(
  (window.location.protocol === 'https' ? 'wss://' : 'ws://') + window.location.host + '/', 
  { 
    transports: ["websocket"]
  }
);

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
