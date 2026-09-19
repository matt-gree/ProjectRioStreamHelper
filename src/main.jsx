import 'vite/modulepreload-polyfill';
import './index.css';
import React from 'react'
import ReactDOM from 'react-dom/client';
import App from './components/App';

// The app is dark-only. index.html carries the class too, but the server
// renders whichever index.html it finds (a stale dist/ one in dev), so the
// script is the copy that can't go out of date.
document.documentElement.classList.add('dark');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
