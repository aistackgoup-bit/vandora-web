import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import App from './App.tsx';
import './index.css';
import { logger } from './lib/logger';
import { captureAttribution } from './lib/attribution';

captureAttribution();

// Global Error Handling
window.onerror = (message, source, lineno, colno, error) => {
  logger.error('Uncaught Window Error', error || message, {
    source: `JS Runtime (${source}:${lineno}:${colno})`,
    metadata: { source, lineno, colno }
  });
};

window.onunhandledrejection = (event) => {
  logger.error('Unhandled Promise Rejection', event.reason, {
    source: 'Promise Rejection'
  });
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HelmetProvider>
      <App />
    </HelmetProvider>
  </StrictMode>,
);
