import { useState, useEffect, useRef, useCallback } from 'react';

const CHANNEL_NAME = 'hush_session';
const PING_TIMEOUT_MS = 500;
const TAB_ID_KEY = 'hush_tab_id';

/**
 * Returns the stable tab ID for this browser tab.
 *
 * sessionStorage is scoped per tab — each tab gets its own storage partition.
 * Within a tab, refreshes share the same sessionStorage, so the ID persists
 * across within-tab navigations. A truly separate tab (Cmd+T, duplicate tab)
 * gets a fresh sessionStorage with no ID, so it generates a new one.
 *
 * @returns {string} UUID unique to this browser tab
 */
function getTabId() {
  let id = sessionStorage.getItem(TAB_ID_KEY);
  if (!id) {
    id = crypto.randomUUID?.() ?? `tab_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(TAB_ID_KEY, id);
  }
  return id;
}

/**
 * Detects whether another browser tab is already running the Hush session.
 *
 * Protocol:
 *  1. On mount, generate (or reuse) a per-tab UUID stored in sessionStorage.
 *  2. Post `session_ping` with our tabId and wait up to 500ms for a reply.
 *  3. If `session_active` arrives with a DIFFERENT tabId: this is a genuine
 *     second tab — set isBlockedTab = true.
 *  4. If `session_active` arrives with the SAME tabId: this is the pre-refresh
 *     page responding to us — ignore it (same tab refreshing).
 *  5. If nothing arrives within 500ms: this tab becomes primary.
 *  6. If `session_ping` is received (we are the existing tab): reply with
 *     `session_active` including our tabId.
 *  7. If `session_takeover` is received: another tab has claimed the session
 *     — set isBlockedTab = true so this tab yields.
 *
 * Uses sessionStorage tab scoping to distinguish refresh from a real second
 * tab. sessionStorage is per-tab: a refresh reuses the same partition, but a
 * new tab gets a fresh partition with a new UUID.
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
  const tabIdRef = useRef(getTabId());

  useEffect(() => {
    let channel;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
    } catch {
      // BroadcastChannel unavailable — degrade gracefully, allow this tab
      return;
    }
    channelRef.current = channel;

    const tabId = tabIdRef.current;

    // Timeout handle for the 500ms ping window
    const timeoutId = setTimeout(() => {
      // No session_active received → we are the primary tab
      isPrimaryRef.current = true;
    }, PING_TIMEOUT_MS);

    channel.onmessage = (event) => {
      const { type, tabId: senderTabId } = event.data ?? {};

      if (type === 'session_ping' && isPrimaryRef.current) {
        // An existing (primary) tab responds to a new tab's ping
        channel.postMessage({ type: 'session_active', tabId });
        return;
      }

      if (type === 'session_active') {
        // If the responder has the same tabId, it's the pre-refresh version
        // of this same tab — ignore it, this is a refresh not a second tab.
        if (senderTabId === tabId) return;

        // Different tabId — genuine second tab detected
        clearTimeout(timeoutId);
        setIsBlockedTab(true);
        return;
      }

      if (type === 'session_takeover') {
        // Another tab is claiming the session — yield
        isPrimaryRef.current = false;
        setIsBlockedTab(true);
      }
    };

    // Announce ourselves: ask whether any existing tab is already running
    channel.postMessage({ type: 'session_ping', tabId });

    return () => {
      clearTimeout(timeoutId);
      channel.onmessage = null;
      channel.close();
      channelRef.current = null;
    };
  }, []);

  // takeOver: called when the user clicks "Use this one instead".
  // Sends session_takeover to all other tabs, then unblocks this tab.
  const takeOver = useCallback(() => {
    const ch = channelRef.current;
    if (ch) {
      ch.postMessage({ type: 'session_takeover' });
    }
    isPrimaryRef.current = true;
    setIsBlockedTab(false);
  }, []);

  return { isBlockedTab, takeOver };
}
