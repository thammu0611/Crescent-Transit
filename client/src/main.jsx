import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'leaflet/dist/leaflet.css';
import './styles.css';
import './app-ui.css';
import './staff-ui.css';
import './public-ui.css';
import './mobile-look.css';
import './admin-kit.css';
import './liquid-glass.css';
import './layout.css';
import './navbar.css';
import './motion.css';
import './polish.css';
import './home.css';
import './interactions.css';
import './navbar-glass.css';
import './dark.css';
import { applyTheme, savedTheme } from './lib/theme.js';
import App from './App.jsx';
import { installSubmitGuard } from './lib/submitGuard.js';

installSubmitGuard();
applyTheme(savedTheme());

// Offline: the app, route data and seen map tiles (public/sw.js). Not in development.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
