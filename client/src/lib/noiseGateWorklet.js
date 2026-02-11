/**
 * Noise Gate AudioWorklet Processor
 *
 * Implements a noise gate in the audio rendering thread, separate from
 * the main thread. This prevents the gate monitoring loop from interfering
 * with video rendering and UI responsiveness.
 *
 * Features:
 * - RMS-based level detection
 * - Smooth attack/release (10ms attack, 50ms release)
 * - Hold time to prevent flutter (150ms)
 * - Level reporting for UI meter (throttled to ~60ms)
 */

class NoiseGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Gate state
    this.gateOpen = false;
    this.holdTimeRemaining = 0;
    this.enabled = true;
    this.thresholdDb = -50;

    // Smoothing coefficients (calculated per-sample)
    this.attackCoef = 0;
    this.releaseCoef = 0;
    this.currentGain = 0;

    // Level reporting (throttled)
    this.frameCount = 0;
    this.reportInterval = 128; // Report every 128 frames (~2.67ms at 48kHz)

    // Calculate smoothing coefficients for 48kHz sample rate
    // attack = 10ms, release = 50ms
    this.updateCoefficients(48000);

    // Hold time in samples (150ms at 48kHz)
    this.holdTimeSamples = Math.floor(0.15 * 48000);

    // Listen for parameter updates from main thread
    this.port.onmessage = (event) => {
      const { type, enabled, threshold } = event.data;

      if (type === 'updateParams') {
        if (enabled !== undefined) {
          this.enabled = enabled;
          if (!enabled) {
            // Gate disabled — open immediately
            this.gateOpen = true;
            this.currentGain = 1.0;
            this.holdTimeRemaining = 0;
          }
        }

        if (threshold !== undefined) {
          this.thresholdDb = threshold;
        }
      }
    };
  }

  updateCoefficients(sampleRate) {
    // Time constants in seconds
    const attackTime = 0.01; // 10ms
    const releaseTime = 0.05; // 50ms

    // Calculate coefficients: coef = 1 - exp(-1 / (time * sampleRate))
    this.attackCoef = 1 - Math.exp(-1 / (attackTime * sampleRate));
    this.releaseCoef = 1 - Math.exp(-1 / (releaseTime * sampleRate));
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || !input[0]) {
      return true;
    }

    const inputChannel = input[0];
    const outputChannel = output[0];
    const blockSize = inputChannel.length;

    // Calculate RMS for this block
    let sumSquares = 0;
    for (let i = 0; i < blockSize; i++) {
      sumSquares += inputChannel[i] * inputChannel[i];
    }
    const rms = Math.sqrt(sumSquares / blockSize);
    const rmsDb = rms > 0 ? 20 * Math.log10(rms) : -Infinity;

    // Gate logic
    if (this.enabled) {
      if (rmsDb > this.thresholdDb) {
        // Signal above threshold — open gate
        this.gateOpen = true;
        this.holdTimeRemaining = this.holdTimeSamples;
      } else if (this.gateOpen) {
        // Signal below threshold — check hold time
        this.holdTimeRemaining -= blockSize;
        if (this.holdTimeRemaining <= 0) {
          this.gateOpen = false;
        }
      }
    } else {
      // Gate disabled — always open
      this.gateOpen = true;
    }

    // Apply gain with smoothing
    const targetGain = this.gateOpen ? 1.0 : 0.0;
    const coef = targetGain > this.currentGain ? this.attackCoef : this.releaseCoef;

    for (let i = 0; i < blockSize; i++) {
      // Smooth gain transition
      this.currentGain += (targetGain - this.currentGain) * coef;
      outputChannel[i] = inputChannel[i] * this.currentGain;
    }

    // Report level to main thread (throttled)
    this.frameCount++;
    if (this.frameCount >= this.reportInterval) {
      this.frameCount = 0;
      // Normalize -60dB to 0dB → 0 to 100
      const normalized = Math.max(0, Math.min(100, ((rmsDb + 60) / 60) * 100));
      this.port.postMessage({
        type: 'level',
        level: Math.round(normalized),
        gateOpen: this.gateOpen,
      });
    }

    return true;
  }
}

registerProcessor('noise-gate-processor', NoiseGateProcessor);
