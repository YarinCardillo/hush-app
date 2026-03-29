import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/global.css';

// Dev-only: console log buffer + dev toolbar + eruda mobile console.
if (import.meta.env.DEV || import.meta.env.VITE_DEBUG_TOOLBAR === 'true') {
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

  // Dev toolbar: draggable debug pill with two buttons
  document.addEventListener('DOMContentLoaded', () => {
    const STORAGE_KEY = 'hush:debug-toolbar-pos';
    const saved = (() => {
      try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; }
    })();

    const bar = document.createElement('div');
    Object.assign(bar.style, {
      position: 'fixed',
      left: saved?.x != null ? `${saved.x}px` : '4px',
      top: saved?.y != null ? `${saved.y}px` : 'auto',
      bottom: saved?.y != null ? 'auto' : '70px',
      zIndex: '99999',
      display: 'flex', gap: '4px', opacity: '0.55',
      padding: '4px 6px',
      background: '#1a1a2e', border: '1px solid #444',
      borderRadius: '6px', cursor: 'grab',
      userSelect: 'none', touchAction: 'none',
    });
    bar.addEventListener('mouseenter', () => { bar.style.opacity = '1'; });
    bar.addEventListener('mouseleave', () => { if (!isDragging) bar.style.opacity = '0.55'; });

    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };
    let didDrag = false;

    const onPointerDown = (e) => {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      didDrag = false;
      const rect = bar.getBoundingClientRect();
      dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      bar.style.cursor = 'grabbing';
      bar.style.opacity = '1';
      bar.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      didDrag = true;
      const x = Math.max(0, Math.min(e.clientX - dragOffset.x, window.innerWidth - bar.offsetWidth));
      const y = Math.max(0, Math.min(e.clientY - dragOffset.y, window.innerHeight - bar.offsetHeight));
      bar.style.left = `${x}px`;
      bar.style.top = `${y}px`;
      bar.style.bottom = 'auto';
    };

    const onPointerUp = () => {
      if (!isDragging) return;
      isDragging = false;
      bar.style.cursor = 'grab';
      bar.style.opacity = '0.55';
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          x: parseInt(bar.style.left), y: parseInt(bar.style.top),
        }));
      } catch { /* quota */ }
    };

    bar.addEventListener('pointerdown', onPointerDown);
    bar.addEventListener('pointermove', onPointerMove);
    bar.addEventListener('pointerup', onPointerUp);

    const mkBtn = (label, fn) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = (e) => { if (!didDrag) fn(); };
      Object.assign(b.style, {
        padding: '3px 6px', fontSize: '10px', fontFamily: 'monospace',
        background: 'transparent', color: '#aaa', border: 'none',
        cursor: 'pointer', whiteSpace: 'nowrap',
      });
      b.addEventListener('mouseenter', () => { b.style.color = '#fff'; });
      b.addEventListener('mouseleave', () => { b.style.color = '#aaa'; });
      return b;
    };

    const grip = document.createElement('span');
    grip.textContent = '\u2630';
    Object.assign(grip.style, { fontSize: '11px', color: '#666', marginRight: '2px' });

    bar.appendChild(grip);
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
