import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/global.css';

// Dev-only: console log buffer + dev toolbar + eruda mobile console.
if (import.meta.env.DEV) {
  const _logBuffer = [];
  const MAX_BUFFER = 1000;
  const ts = () => new Date().toISOString().slice(11, 23);

  // Deep-serialize any value including Error objects, nested objects, etc.
  function serialize(val, depth = 0) {
    if (depth > 4) return '[...]';
    if (val === null) return 'null';
    if (val === undefined) return 'undefined';
    if (typeof val === 'string') return val;
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (val instanceof Error) {
      const parts = [val.name || 'Error', val.message];
      if (val.stack) parts.push('\n' + val.stack);
      // Capture non-standard Error properties (code, reason, status, etc.)
      for (const k of Object.getOwnPropertyNames(val)) {
        if (!['name', 'message', 'stack'].includes(k)) {
          try { parts.push(`  ${k}: ${serialize(val[k], depth + 1)}`); } catch { /* skip */ }
        }
      }
      return parts.join(' | ');
    }
    if (Array.isArray(val)) {
      return '[' + val.map(v => serialize(v, depth + 1)).join(', ') + ']';
    }
    if (typeof val === 'object') {
      try {
        const keys = Object.keys(val);
        if (keys.length === 0) return '{}';
        return '{ ' + keys.map(k => {
          try { return `${k}: ${serialize(val[k], depth + 1)}`; } catch { return `${k}: [err]`; }
        }).join(', ') + ' }';
      } catch { return String(val); }
    }
    return String(val);
  }

  for (const level of ['log', 'warn', 'error', 'info', 'debug']) {
    const orig = console[level].bind(console);
    console[level] = (...args) => {
      const line = `[${ts()}] [${level.toUpperCase()}] ${args.map(a => serialize(a)).join(' ')}`;
      _logBuffer.push(line);
      if (_logBuffer.length > MAX_BUFFER) _logBuffer.shift();
      orig(...args);
    };
  }

  // Also capture unhandled errors and promise rejections
  window.addEventListener('error', (e) => {
    _logBuffer.push(`[${ts()}] [UNCAUGHT] ${e.message} at ${e.filename}:${e.lineno}:${e.colno}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    _logBuffer.push(`[${ts()}] [UNHANDLED_REJECTION] ${serialize(e.reason)}`);
  });

  window.__copyConsole = async () => {
    const text = _logBuffer.join('\n');
    try {
      await navigator.clipboard.writeText(text);
      alert(`Copied ${_logBuffer.length} log entries`);
    } catch {
      prompt('Copy all:', text);
    }
  };

  window.__clearBrowser = async () => {
    try {
      const dbs = await indexedDB.databases();
      dbs.forEach(db => indexedDB.deleteDatabase(db.name));
    } catch { /* older browsers */ }
    sessionStorage.clear();
    localStorage.clear();
    alert('Cleared. Reloading...');
    location.reload();
  };

  // Dev toolbar: two small buttons, bottom-left
  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('div');
    Object.assign(bar.style, {
      position: 'fixed', bottom: '70px', left: '4px', zIndex: '99999',
      display: 'flex', gap: '4px', opacity: '0.6',
    });

    const mkBtn = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = fn;
      Object.assign(b.style, {
        padding: '4px 7px', fontSize: '10px', fontFamily: 'monospace',
        background: '#1a1a2e', color: '#eee', border: '1px solid #444',
        borderRadius: '4px', cursor: 'pointer',
      });
      return b;
    };

    bar.appendChild(mkBtn('Copy Log', () => window.__copyConsole()));
    bar.appendChild(mkBtn('Wipe & Reload', () => window.__clearBrowser()));
    document.body.appendChild(bar);
  });

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
