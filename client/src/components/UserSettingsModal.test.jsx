import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

const {
  mockNavigate,
  mockUpdateVaultTimeout,
  mockSelectMic,
  mockSelectWebcam,
  mockRequestPermission,
  mockRefreshDevices,
  mockMicMonitorStart,
  mockMicMonitorStop,
  mockMicMonitorSetError,
  mockMicMonitorUpdateSettings,
  micMonitorState,
} = vi.hoisted(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  });

  return {
    mockNavigate: vi.fn(),
    mockUpdateVaultTimeout: vi.fn(),
    mockSelectMic: vi.fn(),
    mockSelectWebcam: vi.fn(),
    mockRequestPermission: vi.fn(),
    mockRefreshDevices: vi.fn().mockResolvedValue(undefined),
    mockMicMonitorStart: vi.fn().mockResolvedValue(undefined),
    mockMicMonitorStop: vi.fn().mockResolvedValue(undefined),
    mockMicMonitorSetError: vi.fn(),
    mockMicMonitorUpdateSettings: vi.fn(),
    micMonitorState: {
      isTesting: false,
      level: 0,
      gateOpen: false,
      error: null,
    },
  };
});

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', username: 'alice', displayName: 'Alice' },
    performLogout: vi.fn(),
    logout: vi.fn(),
    updateVaultTimeout: mockUpdateVaultTimeout,
  }),
}));

vi.mock('../hooks/useDevices', () => ({
  useDevices: () => ({
    audioDevices: [
      { deviceId: 'mic-1', label: 'Studio Mic' },
      { deviceId: 'mic-2', label: 'USB Mic' },
    ],
    videoDevices: [
      { deviceId: 'cam-1', label: 'Main Webcam' },
    ],
    selectedMicId: 'mic-1',
    selectedWebcamId: 'cam-1',
    selectMic: mockSelectMic,
    selectWebcam: mockSelectWebcam,
    requestPermission: mockRequestPermission,
    refreshDevices: mockRefreshDevices,
  }),
}));

vi.mock('../hooks/useBreakpoint', () => ({
  useBreakpoint: () => 'desktop',
}));

vi.mock('../hooks/useMicMonitor', () => ({
  useMicMonitor: () => ({
    ...micMonitorState,
    setError: mockMicMonitorSetError,
    start: mockMicMonitorStart,
    stop: mockMicMonitorStop,
    updateSettings: mockMicMonitorUpdateSettings,
  }),
}));

vi.mock('./DeviceManagement.jsx', () => ({
  default: function MockDeviceManagement() {
    return <div>Device Management</div>;
  },
}));

vi.mock('./InstancesSettingsTab.jsx', () => ({
  default: function MockInstancesSettingsTab() {
    return <div>Instances Settings</div>;
  },
}));

import UserSettingsModal from './UserSettingsModal.jsx';

async function openAudioVideoTab() {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /audio & video/i }));
  });
}

describe('UserSettingsModal', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    localStorage.clear();
    micMonitorState.isTesting = false;
    micMonitorState.level = 0;
    micMonitorState.gateOpen = false;
    micMonitorState.error = null;
  });

  afterEach(() => {
    cleanup();
  });

  it('initializes vault timeout from the per-user vault config', () => {
    localStorage.setItem(
      'hush_vault_config_user-1',
      JSON.stringify({ timeout: 60, pinType: 'pin' }),
    );

    render(<UserSettingsModal onClose={vi.fn()} />);

    expect(screen.getByRole('combobox')).toHaveValue('1h');
  });

  it('normalizes and persists vault timeout changes through auth', () => {
    render(<UserSettingsModal onClose={vi.fn()} />);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '15m' } });

    expect(mockUpdateVaultTimeout).toHaveBeenCalledWith(15);
  });

  it('persists noise gate threshold changes and updates the active mic pipeline', async () => {
    const onMicFilterSettingsChange = vi.fn();
    render(
      <UserSettingsModal
        onClose={vi.fn()}
        voiceRuntime={{ onMicFilterSettingsChange }}
      />,
    );

    await openAudioVideoTab();

    fireEvent.change(screen.getByRole('slider', { name: /gate threshold/i }), {
      target: { value: '-42' },
    });

    expect(localStorage.getItem('hush_mic_noise_gate_threshold_db')).toBe('-42');
    expect(onMicFilterSettingsChange).toHaveBeenCalledWith(
      expect.objectContaining({ noiseGateThresholdDb: -42 }),
    );
    expect(mockMicMonitorUpdateSettings).toHaveBeenCalledWith(
      expect.objectContaining({ noiseGateThresholdDb: -42 }),
    );
  });

  it('starts isolated mic testing when the user is already in a voice room', async () => {
    const voiceRuntime = {
      isInVoice: true,
      isMuted: false,
      isDeafened: false,
      onMute: vi.fn(),
      onDeafen: vi.fn(),
      onMicFilterSettingsChange: vi.fn(),
    };

    render(<UserSettingsModal onClose={vi.fn()} voiceRuntime={voiceRuntime} />);

    await openAudioVideoTab();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start test/i }));
    });

    expect(voiceRuntime.onDeafen).toHaveBeenCalledTimes(1);
    expect(mockMicMonitorStart).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'mic-1',
        settings: expect.objectContaining({ noiseGateEnabled: true, noiseGateThresholdDb: -50 }),
      }),
    );
    expect(mockRefreshDevices).toHaveBeenCalled();
  });

  it('restarts mic monitoring when the selected microphone changes during a test', async () => {
    micMonitorState.isTesting = true;

    render(<UserSettingsModal onClose={vi.fn()} />);

    await openAudioVideoTab();

    await act(async () => {
      fireEvent.change(screen.getAllByRole('combobox')[0], {
        target: { value: 'mic-2' },
      });
    });

    expect(mockSelectMic).toHaveBeenCalledWith('mic-2');
    expect(mockMicMonitorStop).toHaveBeenCalled();
    expect(mockMicMonitorStart).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: 'mic-2',
        settings: expect.objectContaining({ noiseGateThresholdDb: -50 }),
      }),
    );
  });
});
