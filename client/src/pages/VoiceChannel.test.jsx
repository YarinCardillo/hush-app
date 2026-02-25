import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../lib/bandwidthEstimator', () => ({
  estimateUploadSpeed: vi.fn(() => Promise.resolve({ uploadMbps: 10 })),
  getRecommendedQuality: vi.fn(() => ({ key: 'source', uploadMbps: 10 })),
  measureLiveUploadMbps: vi.fn(() => Promise.resolve({ mbps: 10, bytesSent: 0, timestamp: 0 })),
}));
vi.mock('../components/Chat', () => ({
  default: function MockChat() {
    return <div data-testid="chat">Chat</div>;
  },
}));

import VoiceChannel from './VoiceChannel';

const mockConnectRoom = vi.fn(() => Promise.resolve());
const mockDisconnectRoom = vi.fn(() => Promise.resolve());

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(),
}));
vi.mock('../hooks/useSignal', () => ({
  useSignal: vi.fn(() => ({
    encryptForUser: vi.fn(),
    decryptFromUser: vi.fn(),
  })),
}));
vi.mock('../hooks/useRoom', () => ({
  useRoom: vi.fn(),
}));
vi.mock('../hooks/useBreakpoint', () => ({
  useBreakpoint: vi.fn(() => 'desktop'),
}));
vi.mock('../hooks/useDevices', () => ({
  useDevices: vi.fn(() => ({
    audioDevices: [],
    videoDevices: [],
    selectedMicId: null,
    selectedWebcamId: null,
    selectMic: vi.fn(),
    selectWebcam: vi.fn(),
    hasSavedMic: false,
    hasSavedWebcam: false,
    requestPermission: vi.fn(),
  })),
}));
vi.mock('../lib/signalStore', () => ({
  openStore: vi.fn(() => Promise.resolve(null)),
}));

let ControlsProps = null;
vi.mock('../components/Controls', () => ({
  default: function MockControls(props) {
    ControlsProps = props;
    return <div data-testid="controls">Controls</div>;
  },
}));

import { useAuth } from '../contexts/AuthContext';
import { useRoom } from '../hooks/useRoom';

function renderVoiceChannel(channel, serverId = 's1') {
  return render(
    <MemoryRouter>
      <VoiceChannel
        channel={channel}
        serverId={serverId}
        getToken={() => 'token'}
        wsClient={{}}
      />
    </MemoryRouter>,
  );
}

describe('VoiceChannel', () => {
  beforeEach(() => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'user-1', displayName: 'Test User' },
    });
    vi.mocked(useRoom).mockReturnValue({
      isReady: true,
      error: null,
      localTracks: new Map(),
      remoteTracks: new Map(),
      participants: [],
      connectRoom: mockConnectRoom,
      disconnectRoom: mockDisconnectRoom,
      publishScreen: vi.fn(),
      unpublishScreen: vi.fn(),
      changeQuality: vi.fn(),
      publishWebcam: vi.fn(),
      unpublishWebcam: vi.fn(),
      publishMic: vi.fn(),
      unpublishMic: vi.fn(),
      availableScreens: new Map(),
      watchedScreens: new Set(),
      loadingScreens: new Set(),
      watchScreen: vi.fn(),
      unwatchScreen: vi.fn(),
      mediaE2EEUnavailable: false,
      keyExchangeMessage: null,
    });
    ControlsProps = null;
    mockConnectRoom.mockClear();
  });

  it('renders channel name and Live badge', () => {
    const channel = { id: 'ch1', name: 'voice-1', serverId: 's1', type: 'voice', voiceMode: 'quality' };
    renderVoiceChannel(channel);
    expect(screen.getByText('#voice-1')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
  });

  it('calls connectRoom with derived room name and displayName', async () => {
    const channel = { id: 'ch1', name: 'voice-1', serverId: 's1', type: 'voice', voiceMode: 'quality' };
    renderVoiceChannel(channel, 's1');
    await waitFor(() => {
      expect(mockConnectRoom).toHaveBeenCalledWith(
        'server-s1-channel-ch1',
        'Test User',
        'ch1',
      );
    });
  });

  it('hides video controls in low-latency mode', () => {
    const channel = {
      id: 'ch1',
      name: 'voice-1',
      serverId: 's1',
      type: 'voice',
      voiceMode: 'low-latency',
    };
    renderVoiceChannel(channel);
    expect(ControlsProps).not.toBeNull();
    expect(ControlsProps.showScreenShare).toBe(false);
    expect(ControlsProps.showWebcam).toBe(false);
    expect(ControlsProps.showQualityPicker).toBe(false);
  });

  it('shows video controls in quality mode', () => {
    const channel = {
      id: 'ch1',
      name: 'voice-1',
      serverId: 's1',
      type: 'voice',
      voiceMode: 'quality',
    };
    renderVoiceChannel(channel);
    expect(ControlsProps).not.toBeNull();
    expect(ControlsProps.showScreenShare).toBe(true);
    expect(ControlsProps.showWebcam).toBe(true);
    expect(ControlsProps.showQualityPicker).toBe(true);
  });
});
