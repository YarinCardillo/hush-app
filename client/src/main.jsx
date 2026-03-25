import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/global.css';

// Dev-only: console log buffer + copy button + eruda mobile console.
if (import.meta.env.DEV) {
  const _logBuffer = [];
  const MAX_BUFFER = 500;
  const ts = () => new Date().toISOString().slice(11, 23);
  for (const level of ['log', 'warn', 'error', 'info', 'debug']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      const line = `[${ts()}] [${level.toUpperCase()}] ${args.map(a => {
        try { return typeof a === 'object' ? JSON.stringify(a, null, 0) : String(a); }
        catch { return String(a); }
      }).join(' ')}`;
      _logBuffer.push(line);
      if (_logBuffer.length > MAX_BUFFER) _logBuffer.shift();
      orig(...args);
    };
  }
  window.__copyConsole = async () => {
    const text = _logBuffer.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      alert(`Copied ${_logBuffer.length} log entries to clipboard`);
    } catch {
      // Clipboard API may fail — show in prompt for manual copy
      prompt('Copy all console logs:', text);
    }
  };
  // Floating "Copy Console" button — top-right corner
  const btn = document.createElement('button');
  btn.textContent = 'Copy Console';
  btn.onclick = () => window.__copyConsole();
  Object.assign(btn.style, {
    position: 'fixed', bottom: '70px', left: '4px', zIndex: '99999',
    padding: '4px 8px', fontSize: '10px', fontFamily: 'monospace',
    background: '#1a1a2e', color: '#eee', border: '1px solid #444',
    borderRadius: '4px', opacity: '0.5', cursor: 'pointer',
  });
  document.addEventListener('DOMContentLoaded', () => document.body.appendChild(btn));

  import('eruda').then(({ default: eruda }) => eruda.init());
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
