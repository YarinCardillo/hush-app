import { describe, it, expect, beforeEach } from 'vitest';
import {
  getMicFilterSettings,
  normalizeMicFilterSettings,
  setMicFilterSettings,
  MIC_GATE_THRESHOLD_MIN_DB,
  MIC_GATE_THRESHOLD_MAX_DB,
} from './micProcessing';

describe('micProcessing', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns the shipped defaults when no settings are stored', () => {
    expect(getMicFilterSettings()).toEqual({
      noiseGateEnabled: true,
      noiseGateThresholdDb: -50,
    });
  });

  it('normalizes and clamps threshold values', () => {
    expect(normalizeMicFilterSettings({
      noiseGateEnabled: 'yes',
      noiseGateThresholdDb: -120,
    })).toEqual({
      noiseGateEnabled: true,
      noiseGateThresholdDb: MIC_GATE_THRESHOLD_MIN_DB,
    });

    expect(normalizeMicFilterSettings({
      noiseGateEnabled: false,
      noiseGateThresholdDb: 12,
    })).toEqual({
      noiseGateEnabled: false,
      noiseGateThresholdDb: MIC_GATE_THRESHOLD_MAX_DB,
    });
  });

  it('persists normalized mic filter settings to localStorage', () => {
    const normalized = setMicFilterSettings({
      noiseGateEnabled: false,
      noiseGateThresholdDb: -37.4,
    });

    expect(normalized).toEqual({
      noiseGateEnabled: false,
      noiseGateThresholdDb: -37,
    });
    expect(localStorage.getItem('hush_mic_noise_gate_enabled')).toBe('0');
    expect(localStorage.getItem('hush_mic_noise_gate_threshold_db')).toBe('-37');
    expect(getMicFilterSettings()).toEqual(normalized);
  });
});
