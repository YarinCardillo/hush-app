import { useState, useEffect, useRef } from 'react';

const CHANNEL_NAME = 'hush_session';
const PING_TIMEOUT_MS = 500;

/**
 * Detects whether another tab is already running the same Hush session.
 *
 * Protocol:
 *  1. On mount: post `session_ping` and wait up to 500ms for a reply.
 *  2. If `session_active` arrives within the window: this is a duplicate tab
 *     — set isBlockedTab = true.
 *  3. If nothing arrives within 500ms: this tab becomes the primary tab.
 *  4. If `session_ping` is received: we are the existing tab — reply with
 *     `session_active`.
 *  5. If `session_takeover` is received: another tab has claimed the session
 *     — set isBlockedTab = true so this tab yields.
 *
 * Uses a separate `hush_session` channel and never touches `hush_auth`
 * (which carries logout messages unrelated to tab detection).
 *
 * Degrades gracefully when BroadcastChannel is unavailable (private-mode
 * browsers or very old environments): allows all tabs to proceed normally.
 *
 * @returns {{ isBlockedTab: boolean, takeOver: () => void }}
 */
export function useSingleTab() {
  const [isBlockedTab, setIsBlockedTab] = useState(false);
  const channelRef = useRef(null);
  const isPrimaryRef = useRef(false);

  // takeOver is stable across renders
  const takeOverRef = useRef(null);

  useEffect(() => {
    let channel;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      // BroadcastChannel unavailable — degrade gracefully, allow this tab
      return;
    }
    channelRef.current = channel;

    // Timeout handle for the 500ms ping window
    const timeoutId = setTimeout(() => {
      // No session_active received → we are the primary tab
      isPrimaryRef.current = true;
    }, PING_TIMEOUT_MS);

    channel.onmessage = (event) => {
      const { type } = event.data ?? {};

      if (type === 'session_ping' && isPrimaryRef.current) {
        // An existing (primary) tab responds to a new tab's ping
        channel.postMessage({ type: 'session_active' });
        return;
      }

      if (type === 'session_active') {
        // Existing tab acknowledged us — we are a duplicate
        clearTimeout(timeoutId);
        setIsBlockedTab(true);
        return;
      }

      if (type === 'session_takeover') {
        // Another tab is claiming the session — yield
        setIsBlockedTab(true);
      }
    };

    // Announce ourselves: ask whether any existing tab is already running
    channel.postMessage({ type: 'session_ping' });

    return () => {
      clearTimeout(timeoutId);
      channel.onmessage = null;
      channel.close();
      channelRef.current = null;
    };
  }, []);

  // takeOver: called when the user clicks "Use this one instead".
  // Sends session_takeover to all other tabs, then unblocks this tab.
  function takeOver() {
    const ch = channelRef.current;
    if (ch) {
      ch.postMessage({ type: 'session_takeover' });
    }
    isPrimaryRef.current = true;
    setIsBlockedTab(false);
  }

  takeOverRef.current = takeOver;

  return { isBlockedTab, takeOver };
}
