const MIC_GATE_ENABLED_KEY = 'hush_mic_noise_gate_enabled';
const MIC_GATE_THRESHOLD_DB_KEY = 'hush_mic_noise_gate_threshold_db';
const NOISE_GATE_WORKLET_URL = new URL('./noiseGateWorklet.js', import.meta.url);

export const MIC_GATE_THRESHOLD_MIN_DB = -70;
export const MIC_GATE_THRESHOLD_MAX_DB = -20;
export const MIC_GATE_THRESHOLD_STEP_DB = 1;

export const DEFAULT_MIC_FILTER_SETTINGS = Object.freeze({
  noiseGateEnabled: true,
  noiseGateThresholdDb: -50,
});

function clampThreshold(value) {
  return Math.min(MIC_GATE_THRESHOLD_MAX_DB, Math.max(MIC_GATE_THRESHOLD_MIN_DB, value));
}

function resolveStorage(storage) {
  if (storage) return storage;
  if (typeof localStorage === 'undefined') return null;
  return localStorage;
}

/**
 * Normalizes raw mic filter settings into the persisted runtime shape.
 *
 * @param {Partial<{ noiseGateEnabled: boolean, noiseGateThresholdDb: number }>} raw
 * @returns {{ noiseGateEnabled: boolean, noiseGateThresholdDb: number }}
 */
export function normalizeMicFilterSettings(raw = {}) {
  const rawThreshold = raw.noiseGateThresholdDb;
  const threshold = rawThreshold === null || rawThreshold === ''
    ? Number.NaN
    : Number(rawThreshold);
  return {
    noiseGateEnabled: typeof raw.noiseGateEnabled === 'boolean'
      ? raw.noiseGateEnabled
      : DEFAULT_MIC_FILTER_SETTINGS.noiseGateEnabled,
    noiseGateThresholdDb: Number.isFinite(threshold)
      ? clampThreshold(Math.round(threshold))
      : DEFAULT_MIC_FILTER_SETTINGS.noiseGateThresholdDb,
  };
}

/**
 * Loads persisted mic filter settings from storage.
 *
 * @param {Storage|null} [storage]
 * @returns {{ noiseGateEnabled: boolean, noiseGateThresholdDb: number }}
 */
export function getMicFilterSettings(storage) {
  const resolvedStorage = resolveStorage(storage);
  if (!resolvedStorage) {
    return { ...DEFAULT_MIC_FILTER_SETTINGS };
  }

  try {
    return normalizeMicFilterSettings({
      noiseGateEnabled: resolvedStorage.getItem(MIC_GATE_ENABLED_KEY) !== '0',
      noiseGateThresholdDb: resolvedStorage.getItem(MIC_GATE_THRESHOLD_DB_KEY),
    });
  } catch {
    return { ...DEFAULT_MIC_FILTER_SETTINGS };
  }
}

/**
 * Persists mic filter settings to storage.
 *
 * @param {Partial<{ noiseGateEnabled: boolean, noiseGateThresholdDb: number }>} nextSettings
 * @param {Storage|null} [storage]
 * @returns {{ noiseGateEnabled: boolean, noiseGateThresholdDb: number }}
 */
export function setMicFilterSettings(nextSettings, storage) {
  const resolvedStorage = resolveStorage(storage);
  const normalized = normalizeMicFilterSettings({
    ...getMicFilterSettings(resolvedStorage),
    ...nextSettings,
  });

  if (!resolvedStorage) {
    return normalized;
  }

  try {
    resolvedStorage.setItem(MIC_GATE_ENABLED_KEY, normalized.noiseGateEnabled ? '1' : '0');
    resolvedStorage.setItem(MIC_GATE_THRESHOLD_DB_KEY, String(normalized.noiseGateThresholdDb));
  } catch {
    // Ignore storage failures and return the normalized in-memory value.
  }

  return normalized;
}

/**
 * Applies the current mic filter settings to an active noise-gate node.
 *
 * @param {AudioWorkletNode|null} noiseGateNode
 * @param {Partial<{ noiseGateEnabled: boolean, noiseGateThresholdDb: number }>} settings
 * @returns {{ noiseGateEnabled: boolean, noiseGateThresholdDb: number }}
 */
export function applyMicFilterSettingsToNode(noiseGateNode, settings) {
  const normalized = normalizeMicFilterSettings(settings);
  if (noiseGateNode?.port) {
    noiseGateNode.port.postMessage({
      type: 'updateParams',
      enabled: normalized.noiseGateEnabled,
      threshold: normalized.noiseGateThresholdDb,
    });
  }
  return normalized;
}

/**
 * Best-effort warmup for the noise-gate worklet so the first mic publish is faster.
 */
export async function preloadNoiseGateWorklet() {
  try {
    if (typeof AudioContext === 'undefined' || !('audioWorklet' in AudioContext.prototype)) return;
    const ctx = new AudioContext();
    await ctx.audioWorklet.addModule(NOISE_GATE_WORKLET_URL);
    await ctx.close();
  } catch {
    // Best-effort preload only.
  }
}

/**
 * Creates the reusable mic processing graph used for both published mic audio
 * and local mic-test monitoring in settings.
 *
 * @param {MediaStream} stream
 * @param {{ monitorOutput?: boolean, settings?: Partial<{ noiseGateEnabled: boolean, noiseGateThresholdDb: number }> }} [options]
 * @returns {Promise<{
 *   audioContext: AudioContext|null,
 *   noiseGateNode: AudioWorkletNode|null,
 *   rawStream: MediaStream,
 *   processedStream: MediaStream,
 *   updateSettings: (nextSettings: Partial<{ noiseGateEnabled: boolean, noiseGateThresholdDb: number }>) => { noiseGateEnabled: boolean, noiseGateThresholdDb: number },
 *   cleanup: () => Promise<void>,
 * }>}
 */
export async function createMicProcessingPipeline(stream, options = {}) {
  const initialSettings = normalizeMicFilterSettings(
    options.settings ?? getMicFilterSettings(),
  );

  if (typeof AudioContext === 'undefined') {
    return {
      audioContext: null,
      noiseGateNode: null,
      rawStream: stream,
      processedStream: stream,
      updateSettings: (nextSettings) => normalizeMicFilterSettings({
        ...initialSettings,
        ...nextSettings,
      }),
      cleanup: async () => {
        stream.getTracks().forEach((track) => track.stop());
      },
    };
  }

  const audioContext = new AudioContext({ sampleRate: 48_000 });
  const source = audioContext.createMediaStreamSource(stream);
  const mediaDestination = audioContext.createMediaStreamDestination();
  mediaDestination.channelCount = 1;

  let noiseGateNode = null;
  let processingNode = source;
  let monitorGainNode = null;
  let currentSettings = initialSettings;

  if (typeof audioContext.audioWorklet !== 'undefined') {
    try {
      await audioContext.audioWorklet.addModule(NOISE_GATE_WORKLET_URL);
      noiseGateNode = new AudioWorkletNode(audioContext, 'noise-gate-processor');
      source.connect(noiseGateNode);
      processingNode = noiseGateNode;
      applyMicFilterSettingsToNode(noiseGateNode, currentSettings);
    } catch (err) {
      console.warn('[audio] AudioWorklet failed, continuing without noise gate:', err);
    }
  }

  processingNode.connect(mediaDestination);

  if (options.monitorOutput) {
    monitorGainNode = audioContext.createGain();
    monitorGainNode.gain.value = 1;
    processingNode.connect(monitorGainNode);
    monitorGainNode.connect(audioContext.destination);
  }

  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  return {
    audioContext,
    noiseGateNode,
    rawStream: stream,
    processedStream: mediaDestination.stream,
    updateSettings: (nextSettings) => {
      currentSettings = normalizeMicFilterSettings({
        ...currentSettings,
        ...nextSettings,
      });
      applyMicFilterSettingsToNode(noiseGateNode, currentSettings);
      return currentSettings;
    },
    cleanup: async () => {
      try {
        monitorGainNode?.disconnect();
      } catch {
        // Ignore disconnect errors during teardown.
      }
      try {
        noiseGateNode?.disconnect();
      } catch {
        // Ignore disconnect errors during teardown.
      }
      try {
        source.disconnect();
      } catch {
        // Ignore disconnect errors during teardown.
      }

      stream.getTracks().forEach((track) => track.stop());

      if (audioContext.state !== 'closed') {
        try {
          await audioContext.close();
        } catch {
          // Ignore close errors during teardown.
        }
      }
    },
  };
}
