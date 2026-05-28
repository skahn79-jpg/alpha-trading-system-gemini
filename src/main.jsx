import React from 'react';
import { createRoot } from 'react-dom/client';
import TradingPlatform from './trading-platform.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <TradingPlatform />
  </React.StrictMode>
);
