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
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
