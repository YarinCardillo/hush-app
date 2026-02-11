import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY_MIC = 'hush_selectedMic';
const STORAGE_KEY_WEBCAM = 'hush_selectedWebcam';

/**
 * Manages audio/video device enumeration and selection.
 * Persists choices in localStorage.
 */
export function useDevices() {
  const [audioDevices, setAudioDevices] = useState([]);
  const [videoDevices, setVideoDevices] = useState([]);
  const [selectedMicId, setSelectedMicId] = useState(
    () => localStorage.getItem(STORAGE_KEY_MIC) || null,
  );
  const [selectedWebcamId, setSelectedWebcamId] = useState(
    () => localStorage.getItem(STORAGE_KEY_WEBCAM) || null,
  );

  const enumerate = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setAudioDevices(devices.filter((d) => d.kind === 'audioinput'));
      setVideoDevices(devices.filter((d) => d.kind === 'videoinput'));
    } catch (err) {
      console.error('[devices] Enumeration failed:', err);
    }
  }, []);

  useEffect(() => {
    enumerate();
    navigator.mediaDevices.addEventListener('devicechange', enumerate);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', enumerate);
    };
  }, [enumerate]);

  const selectMic = useCallback((deviceId) => {
    setSelectedMicId(deviceId);
    localStorage.setItem(STORAGE_KEY_MIC, deviceId);
  }, []);

  const selectWebcam = useCallback((deviceId) => {
    setSelectedWebcamId(deviceId);
    localStorage.setItem(STORAGE_KEY_WEBCAM, deviceId);
  }, []);

  /**
   * Request temporary permission so enumerateDevices returns labels.
   * Immediately stops the returned tracks.
   */
  const requestPermission = useCallback(async (kind) => {
    try {
      const constraints = kind === 'audio' ? { audio: true } : { video: true };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      stream.getTracks().forEach((t) => t.stop());
      await enumerate();
    } catch (err) {
      console.error(`[devices] Permission request failed (${kind}):`, err);
    }
  }, [enumerate]);

  return {
    audioDevices,
    videoDevices,
    selectedMicId,
    selectedWebcamId,
    selectMic,
    selectWebcam,
    hasSavedMic: selectedMicId !== null,
    hasSavedWebcam: selectedWebcamId !== null,
    requestPermission,
    refreshDevices: enumerate,
  };
}
