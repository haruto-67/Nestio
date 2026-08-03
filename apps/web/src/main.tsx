import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './index.css';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root要素が見つかりません');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
