# Testing Patterns

**Analysis Date:** 2026-03-03

## Test Frameworks

### Go

**Runner:**
- Standard library `testing` package
- No external test runner (uses `go test ./...`)
- Assertion library: `github.com/stretchr/testify` (v1.11.1)

**Utilities:**
- `require` - Assertion that fails test immediately on failure
- `assert` - Assertion that logs failure but continues test
- Pattern: `require` for setup errors, `assert` for behavior checks

**Run Commands:**
```bash
go test ./...           # Run all tests
go test -v ./...        # Verbose output
go test -run TestName   # Run specific test
go test -cover ./...    # Coverage report
```

### JavaScript/TypeScript

**Runner:**
- Vitest 4.0.18
- Config: `client/vitest.config.js`
- Test environment: jsdom (browser environment)

**Assertion Library:**
- Vitest built-in `expect` (Jest-compatible)

**Test Libraries:**
- `@testing-library/react` - Component testing
- `@testing-library/user-event` - User interaction
- `@testing-library/jest-dom` - DOM matchers

**Mocking:**
- `vi` from vitest (Mock functions, timers, modules)
- `fake-indexeddb` - IndexedDB in tests

**Run Commands:**
```bash
npm run test            # Watch mode
npm run test:run        # Single run
```

## Test File Organization

### Go

**Location:**
- Co-located with source: `auth.go` paired with `auth_test.go`
- Same package: `package api` in both files

**Naming:**
- Test functions: `TestSubject_Scenario_Expected` pattern
- Examples:
  - `TestHashPassword_ValidPassword_ReturnsHash`
  - `TestComparePassword_CorrectPassword_ReturnsTrue`
  - `TestCreateChannel_ValidTextChannel_ReturnsChannel`
  - `TestPool_CreateUser_GetUserByID_Integration`

**Structure:**
```
server/internal/api/
├── auth.go
├── auth_test.go
├── channels.go
├── channels_test.go
├── channels_crud_test.go
├── servers.go
├── servers_test.go
├── keys.go
├── keys_test.go
├── mock_store_test.go
└── ...
```

### JavaScript

**Location:**
- Co-located with source: `ServerList.jsx` paired with `ServerList.test.jsx`
- Utilities tested alongside: `api.js` paired with `api.test.js`

**Naming:**
- Test files: `{name}.test.jsx` or `{name}.test.js`
- Test suites: `describe('Component Name', () => { ... })`
- Test cases: `it('behavior description', async () => { ... })`
- Examples:
  - `ChannelList.test.jsx` - Component tests
  - `useAuth.test.jsx` - Hook tests
  - `api.test.js` - API utility tests
  - `signalStore.test.js` - Store tests

**Structure:**
```
client/src/
├── components/
│   ├── ChannelList.jsx
│   ├── ChannelList.test.jsx
│   ├── ServerList.jsx
│   ├── ServerList.test.jsx
│   └── ...
├── hooks/
│   ├── useAuth.jsx
│   ├── useAuth.test.jsx
│   └── ...
├── lib/
│   ├── api.js
│   ├── api.test.js
│   ├── signalStore.js
│   ├── signalStore.test.js
│   └── ...
└── test/
    ├── setup.js          # Global Vitest setup
    ├── cryptoMocks.js    # WASM mock implementations
    └── ...
```

## Test Suite Structure

### Go Tests

**Basic Pattern:**
```go
func TestHashPassword_ValidPassword_ReturnsHash(t *testing.T) {
    hash, err := HashPassword("correcthorsebatterystaple")

    require.NoError(t, err)
    assert.NotEmpty(t, hash)
}
```

**Setup and Cleanup:**
```go
func TestPool_CreateUser_GetUserByID_Integration(t *testing.T) {
    // Setup: Create test database
    pool, cleanup := SetupTestDB(t)
    defer cleanup()  // Cleanup always guaranteed

    // Test: Perform operations
    ctx := context.Background()
    _, err := pool.Exec(ctx, `TRUNCATE sessions, users RESTART IDENTITY CASCADE`)
    require.NoError(t, err)
}
```

**Mock Receivers:**
```go
func TestCreateChannel_ValidTextChannel_ReturnsChannel(t *testing.T) {
    store := &mockStore{}
    token := makeServerAuth(store, userID)

    store.createChannelFn = func(_ context.Context, sid, name, chType string, voiceMode *string, parentID *string, pos int) (*models.Channel, error) {
        assert.Equal(t, serverID, sid)
        assert.Equal(t, "general", name)
        return &models.Channel{ID: chID, ServerID: sid, Name: name, Type: chType, Position: pos}, nil
    }

    router := serversRouterForChannels(store)
    rr := postServerJSON(router, "/"+serverID+"/channels", models.CreateChannelRequest{Name: "general", Type: "text"}, token)
    assert.Equal(t, http.StatusCreated, rr.Code)
}
```

### JavaScript Tests

**Vitest Structure:**
```javascript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';

describe('useAuth', () => {
  let originalFetch;

  beforeEach(() => {
    cleanup();
    originalFetch = globalThis.fetch;
    sessionStorage.clear();
    localStorage.clear();
    vi.mocked(fetchWithAuth).mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('login stores token in sessionStorage and sets user', async () => {
    globalThis.fetch.mockResolvedValue(
      mockFetchOk({
        token: 'jwt-123',
        user: { id: 'user-1', username: 'alice', displayName: 'Alice' },
      })
    );

    const { getByRole, container } = render(<App />);
    await act(async () => {
      getByRole('button', { name: 'Login' }).click();
    });

    await waitFor(() => {
      expect(sessionStorage.getItem(JWT_KEY)).toBe('jwt-123');
    });
  });
});
```

**Component Testing Pattern:**
```javascript
describe('ChannelList', () => {
  it('renders text and voice channels with correct icons', async () => {
    const { getByText } = render(
      <ChannelList
        channels={[
          { id: '1', name: 'general', type: 'text' },
          { id: '2', name: 'voice-1', type: 'voice' }
        ]}
      />
    );
    expect(getByText('general')).toBeInTheDocument();
  });
});
```

**Helper Functions:**
```javascript
/** Creates a mock store with all required methods. */
function createMockStore(identityExists = false) {
  return {
    openStore: vi.fn().mockResolvedValue({}),
    getIdentity: vi.fn().mockResolvedValue(
      identityExists
        ? { publicKey: new Uint8Array(33), privateKey: new Uint8Array(32) }
        : null,
    ),
    setIdentity: vi.fn().mockResolvedValue(undefined),
  };
}

function mockFetchOk(body) {
  return {
    ok: true,
    json: () => Promise.resolve(body),
  };
}
```

## Mocking Patterns

### Go Mocking

**Mock Struct Implementation** (`mock_store_test.go`):
```go
// mockStore implements db.Store with function fields for per-test customization.
type mockStore struct {
    createUserFn            func(ctx context.Context, username, displayName string, passwordHash *string) (*models.User, error)
    getUserByUsernameFn     func(ctx context.Context, username string) (*models.User, error)
    // ... more function fields
}

func (m *mockStore) CreateUser(ctx context.Context, username, displayName string, passwordHash *string) (*models.User, error) {
    if m.createUserFn != nil {
        return m.createUserFn(ctx, username, displayName, passwordHash)
    }
    return nil, nil
}
```

**Mock Usage in Test:**
```go
store := &mockStore{}
store.createUserFn = func(ctx context.Context, username, displayName string, passwordHash *string) (*models.User, error) {
    return &models.User{ID: "user-1", Username: username}, nil
}
```

**What to Mock:**
- All `db.Store` interface methods (central point of data access)
- HTTP handlers only via `httptest.ResponseRecorder`
- Don't mock: password hashing, UUID generation (use real)

**What NOT to Mock:**
- Cryptographic operations (when testing crypto, use real functions)
- Time functions (Go standard library, not mocked)
- External APIs (use httptest.Server for integration tests)

### JavaScript Mocking

**Module Mocking:**
```javascript
vi.mock('../lib/api', () => ({
  fetchWithAuth: vi.fn(),
  uploadKeysAfterAuth: vi.fn().mockResolvedValue(undefined),
}));
```

**Function Mocking:**
```javascript
vi.mocked(fetchWithAuth).mockResolvedValue({
  ok: true,
  json: () => Promise.resolve({ token: 'jwt-123' }),
});

// Reset between tests
vi.mocked(fetchWithAuth).mockReset();
```

**Global Mocking:**
```javascript
globalThis.fetch = vi.fn().mockResolvedValue(
  mockFetchOk({ data: 'value' })
);

// Verify calls
expect(globalThis.fetch).toHaveBeenCalledWith(
  expect.stringContaining('/api/endpoint'),
  expect.objectContaining({ method: 'POST' })
);
```

**What to Mock:**
- External API calls (via `vi.mock()`)
- Storage APIs (sessionStorage, localStorage)
- WASM modules (in `client/src/test/cryptoMocks.js`)

**What NOT to Mock:**
- React hooks from testing-library (render, screen, waitFor)
- User interactions (handled by @testing-library/user-event)
- Component render itself (test actual behavior)

## Test Types

### Go

**Unit Tests:**
- Scope: Single function or handler
- Database: No real DB (use mockStore)
- Examples:
  - `TestHashPassword_ValidPassword_ReturnsHash` - Pure function
  - `TestComparePassword_CorrectPassword_ReturnsTrue` - Pure crypto

**Integration Tests:**
- Scope: Multiple components or real database
- Database: Real PostgreSQL via `SetupTestDB(t)`
- Setup: Run migrations, cleanup with `defer cleanup()`
- Examples:
  - `TestPool_CreateUser_GetUserByID_Integration` - Real DB round-trip
  - Handler tests in `auth_test.go` - HTTP + mock store

**HTTP Handler Tests:**
- Use `httptest.NewRequest()` and `httptest.NewRecorder()`
- Test via router: `serverHandler.ServeHTTP(rr, req)`
- Assert status code and response body

### JavaScript

**Unit Tests:**
- Scope: Single function or hook
- Mocking: All external APIs
- Examples:
  - `uploadKeysAfterAuth` tests - Pure logic with mocked store
  - Hook tests - useAuth behavior

**Component Tests:**
- Scope: Component render and interaction
- Rendering: `render(<Component />)` via testing-library
- Assertion: Screen content, DOM state
- Examples:
  - `ChannelList.test.jsx` - Renders channels correctly
  - `ServerList.test.jsx` - User interactions

**E2E Tests:**
- Not yet implemented (framework not configured)
- Would test full user flows (Playwright or similar)

## Global Test Setup

### Go

**Test Database Setup** (`testdb.go`):
```go
func SetupTestDB(t *testing.T) (*db.Pool, func()) {
    // Create temp database
    // Run migrations
    // Return pool and cleanup function
    pool, _ := db.New(dbURL)
    return pool, func() { pool.Close() }
}
```

**Fixture Pattern:**
```go
pool, cleanup := SetupTestDB(t)
defer cleanup()

_, err := pool.Exec(ctx, `TRUNCATE sessions, users RESTART IDENTITY CASCADE`)
require.NoError(t, err)

username := "testuser_" + uuid.New().String()[:8]
user, err := pool.CreateUser(ctx, username, "Test User", &hash)
require.NoError(t, err)
```

### JavaScript

**Global Setup** (`client/src/test/setup.js`):
```javascript
import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
```

**Per-Test Setup:**
```javascript
beforeEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  vi.resetAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});
```

**Vitest Config** (`client/vitest.config.js`):
```javascript
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: false,  // Explicit imports required
    include: ['src/**/*.test.{js,jsx,ts,tsx}'],
    setupFiles: ['src/test/setup.js'],
  },
});
```

## Async Testing

### Go

**No Async in Standard Tests:**
- Go testing is synchronous by default
- `context.Background()` passed for DB operations
- No goroutine-level assertions (use sync primitives)

### JavaScript

**Promise Testing:**
```javascript
it('generates keys and uploads public payload when identity is missing', async () => {
  const mockStore = createMockStore(false);
  const mockCrypto = createMockCrypto();

  await uploadKeysAfterAuth(token, userId, deviceId, {
    store: mockStore,
    crypto: mockCrypto,
    uploadKeys: vi.fn().mockResolvedValue(undefined),
  });

  expect(mockStore.openStore).toHaveBeenCalledWith(userId, deviceId);
});
```

**React Component Async:**
```javascript
it('login stores token in sessionStorage and sets user', async () => {
  globalThis.fetch.mockResolvedValue(
    mockFetchOk({ token: 'jwt-123', user: { id: 'user-1' } })
  );

  const { getByRole } = render(<App />);

  await act(async () => {
    getByRole('button', { name: 'Login' }).click();
  });

  await waitFor(() => {
    expect(sessionStorage.getItem(JWT_KEY)).toBe('jwt-123');
  });
});
```

**Error Testing:**
```javascript
it('does not call uploadKeys when identity already exists', async () => {
  const mockStore = createMockStore(true);  // identityExists=true
  const mockUploadKeys = vi.fn();

  await uploadKeysAfterAuth(token, userId, deviceId, {
    store: mockStore,
    crypto: mockCrypto,
    uploadKeys: mockUploadKeys,
  });

  expect(mockUploadKeys).not.toHaveBeenCalled();
});
```

## Coverage

### Go

**Coverage Report:**
```bash
go test -cover ./...
go test -coverprofile=coverage.out ./...
go tool cover -html=coverage.out
```

**Current Coverage:**
- Multiple handlers with 40+ tests across api, auth, db packages
- Not enforced via CI flag

### JavaScript

**Coverage:**
```bash
vitest run --coverage
```

**Tool:** `@vitest/coverage-v8` (v8 engine)

**Current Coverage:**
- Components, hooks, and utilities tested
- Not enforced via CI flag

## Common Test Patterns

### Go: HTTP Handler Testing

```go
// Create mock store
store := &mockStore{}

// Define mock behavior
store.getUserByUsernameFn = func(ctx context.Context, username string) (*models.User, error) {
    if username == "alice" {
        return &models.User{ID: "user-1", Username: "alice"}, nil
    }
    return nil, nil
}

// Create request
req := httptest.NewRequest(http.MethodPost, "/api/auth/login", bytes.NewReader(body))
req.Header.Set("Content-Type", "application/json")

// Record response
rr := httptest.NewRecorder()
router := AuthRoutes(store, testJWTSecret, testJWTExpiry)
router.ServeHTTP(rr, req)

// Assert
assert.Equal(t, http.StatusOK, rr.Code)
```

### JavaScript: Component Test with Mocks

```javascript
vi.mock('../lib/api', () => ({
  fetchWithAuth: vi.fn(),
}));

describe('ChannelList', () => {
  it('renders text and voice channels with correct icons', async () => {
    vi.mocked(fetchWithAuth).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([
        { id: '1', name: 'general', type: 'text' },
        { id: '2', name: 'voice-1', type: 'voice' }
      ]),
    });

    const { getByText } = render(<ChannelList channels={[...]} />);

    await waitFor(() => {
      expect(getByText('general')).toBeInTheDocument();
    });
  });
});
```

---

*Testing analysis: 2026-03-03*
