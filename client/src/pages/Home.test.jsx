import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import Home from './Home';

vi.mock('../utils/constants', () => ({
  APP_VERSION: 'test-version',
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({
    vaultState: 'none',
    user: null,
    performRegister: vi.fn(),
    performRecovery: vi.fn(),
    unlockVault: vi.fn(),
    setPIN: vi.fn(),
    isAuthenticated: false,
    loading: false,
    error: null,
    clearError: vi.fn(),
    needsPinSetup: false,
    skipPinSetup: vi.fn(),
  })),
}));

vi.mock('../components/auth/RegistrationWizard', () => ({
  RegistrationWizard: function MockRegistrationWizard() {
    return <div>Registration Wizard</div>;
  },
  hasInterruptedRegistration: vi.fn().mockResolvedValue(false),
}));

vi.mock('../components/auth/RecoveryPhraseInput', () => ({
  RecoveryPhraseInput: function MockRecoveryPhraseInput() {
    return <div>Recovery Phrase Input</div>;
  },
}));

vi.mock('../components/auth/PinUnlockScreen', () => ({
  PinUnlockScreen: function MockPinUnlockScreen() {
    return <div>PIN Unlock</div>;
  },
}));

vi.mock('../components/auth/PinSetupModal', () => ({
  PinSetupModal: function MockPinSetupModal() {
    return <div>PIN Setup</div>;
  },
}));

vi.mock('motion/react', () => {
  const passthrough = (Tag) => function MotionPassthrough({ children, ...props }) {
    return <Tag {...props}>{children}</Tag>;
  };

  return {
    motion: {
      div: passthrough('div'),
      span: passthrough('span'),
    },
    AnimatePresence: function AnimatePresence({ children }) {
      return <>{children}</>;
    },
  };
});

function renderHome() {
  return render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>,
  );
}

describe('Home', () => {
  let originalFetch;
  let originalMatchMedia;
  let originalCreateRange;
  let originalResizeObserver;
  let originalFonts;

  beforeEach(() => {
    cleanup();

    originalFetch = global.fetch;
    originalMatchMedia = window.matchMedia;
    originalCreateRange = document.createRange;
    originalResizeObserver = global.ResizeObserver;
    originalFonts = document.fonts;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ capabilities: {} }),
    });

    window.matchMedia = vi.fn((query) => ({
      matches: query === '(pointer: coarse)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    document.createRange = vi.fn(() => ({
      setStart: vi.fn(),
      setEnd: vi.fn(),
      getBoundingClientRect: vi.fn(() => ({ left: 0, width: 12 })),
    }));

    global.ResizeObserver = class MockResizeObserver {
      observe() {}
      disconnect() {}
    };

    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: Promise.resolve() },
    });
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    window.matchMedia = originalMatchMedia;
    document.createRange = originalCreateRange;
    global.ResizeObserver = originalResizeObserver;

    if (originalFonts === undefined) {
      // eslint-disable-next-line no-undefined
      delete document.fonts;
    } else {
      Object.defineProperty(document, 'fonts', {
        configurable: true,
        value: originalFonts,
      });
    }
  });

  it('keeps the sign-in auth shell scrollable on mobile', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();

    await user.click(screen.getByRole('button', { name: /sign in/i }));

    expect(screen.getByText('Recovery Phrase Input')).toBeInTheDocument();
    expect(container.querySelector('.home-page')).toHaveStyle({
      overflowY: 'auto',
      overflowX: 'hidden',
    });
    expect(document.body.dataset.hushScrollMode).toBe('scroll');
    expect(document.body.style.overflowY).toBe('auto');
  });

  it('keeps the registration flow scrollable on mobile', async () => {
    const user = userEvent.setup();
    const { container } = renderHome();

    await user.click(screen.getByRole('button', { name: /create an account/i }));

    expect(screen.getByText('Registration Wizard')).toBeInTheDocument();
    expect(container.querySelector('.home-page')).toHaveStyle({
      overflowY: 'auto',
      overflowX: 'hidden',
    });
    expect(document.body.dataset.hushScrollMode).toBe('scroll');
    expect(document.body.style.overflowY).toBe('auto');
  });
});
