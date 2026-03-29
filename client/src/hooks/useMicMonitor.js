import { useCallback, useEffect, useRef, useState } from 'react';
import { createMicProcessingPipeline } from '../lib/micProcessing';

/**
 * Local microphone monitor used by the settings screen to let the user hear
 * the processed mic signal in isolation while tuning filters.
 */
export function useMicMonitor() {
  const isMountedRef = useRef(true);
  const sessionRef = useRef(null);
  const [isTesting, setIsTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [gateOpen, setGateOpen] = useState(false);
  const [error, setError] = useState(null);

  const stop = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = null;

    if (session?.noiseGateNode?.port) {
      session.noiseGateNode.port.onmessage = null;
    }

    if (isMountedRef.current) {
      setIsTesting(false);
      setLevel(0);
      setGateOpen(false);
    }

    if (session?.cleanup) {
      await session.cleanup();
    }
  }, []);

  const start = useCallback(async ({ deviceId, settings }) => {
    await stop();
    setError(null);

    const audioConstraints = {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    };
    if (deviceId) {
      audioConstraints.deviceId = { exact: deviceId };
    }

    const stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints });
    const session = await createMicProcessingPipeline(stream, {
      monitorOutput: true,
      settings,
    });

    if (session.noiseGateNode?.port) {
      session.noiseGateNode.port.onmessage = (event) => {
        if (event.data?.type !== 'level') return;
        if (!isMountedRef.current) return;
        setLevel(event.data.level ?? 0);
        setGateOpen(Boolean(event.data.gateOpen));
      };
    }

    sessionRef.current = session;
    if (!isMountedRef.current) {
      await session.cleanup();
      return;
    }
    setIsTesting(true);
  }, []);

  const updateSettings = useCallback((settings) => {
    if (!sessionRef.current) return;
    sessionRef.current.updateSettings(settings);
  }, []);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session?.noiseGateNode?.port) {
        session.noiseGateNode.port.onmessage = null;
      }
      if (session?.cleanup) {
        void session.cleanup();
      }
    };
  }, [stop]);

  return {
    isTesting,
    level,
    gateOpen,
    error,
    setError,
    start,
    stop,
    updateSettings,
  };
}
