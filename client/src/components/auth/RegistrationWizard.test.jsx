import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RegistrationWizard } from './RegistrationWizard.jsx';

const ORIGINAL_MNEMONIC = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';
const NEW_MNEMONIC = 'nu xi omicron pi rho sigma tau upsilon phi chi psi omega';
const REG_SESSION_KEY = 'hush_reg_wizard';
const REG_DB_NAME = 'hush-reg-wizard';
const REG_DB_STORE = 'state';

const generateIdentityMnemonic = vi.hoisted(() => vi.fn(() => ORIGINAL_MNEMONIC));
const checkUsernameAvailable = vi.hoisted(() => vi.fn().mockResolvedValue(true));

vi.mock('../../lib/bip39Identity', () => ({
  generateIdentityMnemonic,
}));

vi.mock('../../lib/api', () => ({
  checkUsernameAvailable,
}));

function deleteRegistrationDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(REG_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

function seedWizardSessionState(state) {
  sessionStorage.setItem(
    REG_SESSION_KEY,
    JSON.stringify({
      savedAt: Date.now(),
      ...state,
    }),
  );
}

function writeWizardIdbState(state) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(REG_DB_NAME, 1);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(REG_DB_STORE);
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(REG_DB_STORE, 'readwrite');
      tx.objectStore(REG_DB_STORE).put({
        savedAt: Date.now(),
        ...state,
      }, 'wizard');
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    };
  });
}

function renderWizard() {
  return render(
    <RegistrationWizard
      onComplete={vi.fn().mockResolvedValue(undefined)}
      onCancel={vi.fn()}
    />,
  );
}

describe('RegistrationWizard hardening', () => {
  beforeEach(async () => {
    cleanup();
    generateIdentityMnemonic.mockReset();
    generateIdentityMnemonic.mockReturnValue(ORIGINAL_MNEMONIC);
    checkUsernameAvailable.mockReset();
    checkUsernameAvailable.mockResolvedValue(true);
    sessionStorage.clear();
    localStorage.clear();
    await deleteRegistrationDb();
  });

  afterEach(async () => {
    cleanup();
    sessionStorage.clear();
    localStorage.clear();
    await deleteRegistrationDb();
  });

  it('hides the in-app back button on the mnemonic confirmation step', () => {
    seedWizardSessionState({
      step: 'MNEMONIC_CONFIRM',
      pastDisplayStep: true,
      mnemonic: ORIGINAL_MNEMONIC,
      challengePositions: [0, 4, 8],
    });

    renderWizard();

    expect(screen.getByRole('button', { name: /start over/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^← back$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^your recovery phrase$/i)).not.toBeInTheDocument();
  });

  it('blocks the mnemonic display step once the user has moved past it', () => {
    seedWizardSessionState({
      step: 'MNEMONIC_DISPLAY',
      pastDisplayStep: true,
      mnemonic: ORIGINAL_MNEMONIC,
      challengePositions: [1, 5, 9],
    });

    renderWizard();

    expect(screen.getByRole('button', { name: /start over/i })).toBeInTheDocument();
    expect(screen.queryByText(/write these 12 words down and keep them safe/i)).not.toBeInTheDocument();
  });

  it('regenerates the mnemonic and restarts the wizard when browser back is pressed on confirmation', async () => {
    seedWizardSessionState({
      step: 'MNEMONIC_CONFIRM',
      pastDisplayStep: true,
      username: 'alice',
      displayName: 'Alice',
      mnemonic: ORIGINAL_MNEMONIC,
      challengePositions: [0, 4, 8],
    });
    generateIdentityMnemonic.mockReturnValueOnce(NEW_MNEMONIC);

    renderWizard();

    fireEvent(window, new PopStateEvent('popstate'));

    await screen.findByText(/choose a username/i);
    const persisted = JSON.parse(sessionStorage.getItem(REG_SESSION_KEY));

    expect(persisted.step).toBe('USERNAME');
    expect(persisted.pastDisplayStep).toBe(false);
    expect(persisted.challengePositions).toBe(null);
    expect(persisted.username).toBe('');
    expect(persisted.mnemonic).toBe(NEW_MNEMONIC);
  });

  it('lets the user start over from confirmation with a fresh mnemonic', async () => {
    seedWizardSessionState({
      step: 'MNEMONIC_CONFIRM',
      pastDisplayStep: true,
      username: 'alice',
      displayName: 'Alice',
      mnemonic: ORIGINAL_MNEMONIC,
      challengePositions: [0, 4, 8],
    });
    generateIdentityMnemonic.mockReturnValueOnce(NEW_MNEMONIC);

    const user = userEvent.setup();
    renderWizard();

    await user.click(screen.getByRole('button', { name: /start over/i }));

    await screen.findByText(/choose a username/i);
    const persisted = JSON.parse(sessionStorage.getItem(REG_SESSION_KEY));

    expect(persisted.step).toBe('USERNAME');
    expect(persisted.pastDisplayStep).toBe(false);
    expect(persisted.challengePositions).toBe(null);
    expect(persisted.mnemonic).toBe(NEW_MNEMONIC);
  });

  it('restores the confirmation step from IDB without re-showing the mnemonic words', async () => {
    await writeWizardIdbState({
      step: 'MNEMONIC_CONFIRM',
      pastDisplayStep: true,
      mnemonic: ORIGINAL_MNEMONIC,
      challengePositions: [2, 6, 10],
      username: 'alice',
    });

    renderWizard();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start over/i })).toBeInTheDocument();
    });
    expect(screen.queryByText(/^your recovery phrase$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/write these 12 words down and keep them safe/i)).not.toBeInTheDocument();
  });
});
