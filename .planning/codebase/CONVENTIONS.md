# Coding Conventions

**Analysis Date:** 2026-03-03

## Naming Patterns

### Go Files and Types

**Files:**
- `snake_case.go` for file names - Example: `auth.go`, `servers.go`, `auth_test.go`
- Test files: `{name}_test.go` paired with source file
- Models: `models.go` (single file for all domain types)

**Types (PascalCase):**
- Structs: `User`, `Server`, `Channel`, `Message`, `AuthResponse`
- Interfaces: `Store` (domain interfaces)
- Handlers: `authHandler`, `serverHandler` (unexported receiver types)

**Functions and Methods (camelCase with receiver pattern):**
- Package functions: `HashPassword()`, `CreateServer()`, `GetUserByID()`
- Receiver methods: `(h *authHandler) register()`, `(h *serverHandler) listServers()`
- Private helpers: `generateInviteCode()`, `validateUsername()`
- Error comparison: `if err != nil { ... }` always returns error as last return value

**Constants (UPPER_SNAKE_CASE):**
- `const minPasswordLen = 8`
- `const maxUsernameLen = 128`
- `const maxDisplayLen = 128`
- Compiled regexp: `var usernameRE = regexp.MustCompile(...)`

### JavaScript/TypeScript Files

**Files:**
- Components: `PascalCase.jsx` - Example: `ServerList.jsx`, `ChannelList.jsx`, `HushOrb.jsx`
- Utilities/helpers: `camelCase.js` - Example: `api.js`, `ws.js`, `constants.js`
- Hooks: `useXxx.jsx` - Example: `useAuth.jsx`, `useSignal.jsx`, `useDevices.jsx`
- Tests: `{name}.test.jsx` or `{name}.test.js` co-located with source
- Styles: `modalStyles.js` (shared inline style objects)

**React Components (PascalCase):**
- Components always exported: `export default function ServerList() { ... }`
- Props are destructured in parameters: `function Chat({ channelId, messages })`
- Internal functions in components: `camelCase` (e.g., `getStoredThemeMode()`)

**Functions and Variables (camelCase):**
- Exported functions: `export async function fetchWithAuth(token, path, opts) { ... }`
- Exported constants: `export const API_URL = ...`
- Internal helpers: `function createMockStore(identityExists) { ... }`
- Mock factories: `function mockFetchOk(body) { ... }`

**Constants (UPPER_SNAKE_CASE or camelCase per convention):**
- String constants: `const EXIT_DURATION_MS = 200`
- Object maps: `const QUALITY_PRESETS = { ... }`, `const ROLE_ORDER = ['admin', 'mod', 'member']`
- CSS variable keys: `const THEME_MODE_KEY = 'hush_theme_mode'`
- Magic numbers extracted: `const T_COLOR = '1.0s ease'`

**Booleans (is/has/can prefix):**
- `isAuthenticated`, `isHovered`, `isFullscreen`, `isMounted`
- `hasError`, `hasItems`
- `canDelete`, `canTransfer`

## Code Style

### Formatting

**Go:**
- No explicit formatter configured (uses `gofmt` implicitly)
- Line length: Standard (no strict limit enforced)
- Indentation: Tabs (Go standard)

**JavaScript/TypeScript:**
- No Prettier or ESLint config files present in root
- Imports use ES6 module syntax: `import { ... } from '...'`
- Named exports preferred over default for utilities: `export function fetchWithAuth()`
- Inline styles object pattern: `const styles = { key: { ...cssProps } }`
- Property access via dot notation for known props

### Imports

**Go:**
- Grouped by: standard library, external packages, local imports
- Order in `auth.go`: `encoding/json`, `errors`, `log/slog`, `net/http`, `regexp`, `strings`, `time`, then `hush.app/server`, then external packages
- Each group separated by blank line

**JavaScript:**
- Module imports at top: `import { ... } from 'module'`
- Namespace imports: `import * as signalStore from './signalStore'`
- Components before utilities: `import ServerList from './ServerList'` before `import { fetchWithAuth } from '../lib/api'`
- No path aliases configured (relative imports used throughout)
- Unused destructuring avoided

### Error Handling

**Go Pattern (explicit):**
```go
// Immediate error return with early exit
if err != nil {
    slog.Error("operation name", "err", err)
    writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "user-facing message"})
    return
}

// Or for validation:
if err := validateUsername(req.Username); err != nil {
    writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
    return
}
```

**JavaScript Pattern (Promise-based):**
```javascript
try {
  const response = await fetchWithAuth(token, '/api/endpoint');
  if (!response.ok) {
    // Handle HTTP error
    return;
  }
  const data = await response.json();
} catch (error) {
  // Handle network or parsing error
  console.error(error);
}
```

**Testing Pattern (explicit assertions):**
- Go: `require.NoError(t, err)` for failures that halt test, `assert.Equal()` for specific value checks
- JS: `expect().toThrow()`, `expect().rejects.toThrow()` for async errors

### Logging

**Go:**
- Framework: `log/slog` (standard library)
- Pattern: `slog.Error("context", "err", err)` with structured key-value pairs
- Used for actual errors, not for debug traces
- Location: API handlers after failed operations

**JavaScript:**
- Framework: `console.error()`, `console.warn()`, `console.log()`
- Pattern: Direct calls, no structured logging library
- Limited use in production code

## Comments

**When to Comment:**

**Go:**
- Public API: All exported functions and types have doc comments above definition
- Example: `// AuthRoutes returns the chi router for /api/auth.`
- Private helpers: Only if logic is non-obvious
- Inline: Rare; code should be self-documenting

**JavaScript:**
- JSDoc blocks for exported functions: `/** ... */` above function
- Example: `/** Creates a mock store with all required methods. */`
- Inline comments for complex logic (e.g., CSS transform reasoning)
- Component comments explain design decisions

**Doc Comment Format:**
- Go: `// FunctionName description.`
- JS: `/** FunctionName description. */`

## Function Design

### Size and Complexity

**Go:**
- Handler functions: 20-50 lines (include validation, error handling, response)
- Private helpers: 5-20 lines
- File example: `auth.go` ~191 lines with multiple functions

**JavaScript:**
- Component render: 50-150 lines (includes internal state, effects, render)
- Hook: 20-50 lines
- Utility functions: 5-25 lines

### Parameter Patterns

**Go:**
- First parameter: always `context.Context`
- Receiver: `(h *authHandler)` for methods on handler structs
- Multiple returns: `(value, error)` convention strictly followed
- Pointer receivers for handlers/stores, value receivers for small types

**JavaScript:**
- Destructured props in React components: `function Chat({ channelId, messages })`
- Optional parameters: spread syntax `opts = {}` with defaults
- Callback props: `onClick={() => handler()}` or `onClick={handler}`

### Return Values

**Go:**
- Always return error as last value: `(result, error)`
- Never return both nil and nil
- Use typed errors when possible, e.g., `validateUsername()` returns `error` with message

**JavaScript:**
- Promises preferred: `async function` returns `Promise<T>`
- Throw on error (not returned): `throw new Error('message')`
- React hooks return state/setters: `[value, setValue] = useState()`

## Module Design

### Exports

**Go:**
- Package-level functions exported (PascalCase)
- Types exported if domain model
- Handlers are unexported (lowercase), wired via public route functions
- Example: `ServerRoutes()` public, `serverHandler` private

**JavaScript:**
- Named exports for utilities: `export function fetchWithAuth()`, `export const API_URL`
- Default export for React components: `export default ServerList`
- Re-exports in barrel files: `export { User } from './User'` (not used; each file self-contained)

### File Organization

**Go Structure** (per `server/internal/api/`):
- `auth.go` - Authentication handlers
- `servers.go` - Server CRUD and management
- `channels.go` / `channels_crud_test.go` - Channel operations
- `keys.go` - Cryptographic key management
- `webhook.go` - LiveKit webhook handler
- `mock_store_test.go` - Mock implementation for testing all handlers

**JavaScript Structure** (per `client/src/`):
- `components/` - React components (ServerList, ChannelList, Chat, etc.)
- `contexts/` - React contexts (AuthContext)
- `hooks/` - Custom hooks (useAuth, useSignal)
- `lib/` - Utilities (api.js, ws.js, signalStore.js, e2eeKeyManager.js)
- `pages/` - Page components
- `test/` - Test setup and mocks
- `utils/` - Constants and helpers
- `wasm/` - WASM module bindings (hush_crypto.js)

## Type Patterns

### Go

**Request/Response Models** (in `models.go`):
```go
type RegisterRequest struct {
    Username    string `json:"username"`
    Password    string `json:"password"`
    DisplayName string `json:"displayName"`
}

type AuthResponse struct {
    Token string `json:"token"`
    User  User   `json:"user"`
}
```

**Domain Models:**
```go
type User struct {
    ID           string     `json:"id"`
    Username     string     `json:"username"`
    PasswordHash *string    `json:"-"`  // Never exposed
    DisplayName  string     `json:"displayName"`
    CreatedAt    time.Time  `json:"createdAt"`
}
```

**Pointer Usage:**
- Nullable fields: `*string`, `*time.Time` (e.g., optional user display name)
- Mutable receivers: `func (h *authHandler)`
- Return types: `(*User, error)` for newly created objects

### JavaScript

**No TypeScript** - Plain JavaScript with JSDoc
- Props documented via comment blocks
- Object shapes inferred from usage
- Mock factories: `function createMockStore() { return { method: vi.fn(), ... } }`

## Validation Patterns

**Go:**
- Validate at handler boundary (entry point)
- Return HTTP 400 for validation errors
- Example: `validateUsername()` checks regex, returns error
- Constants define limits: `minPasswordLen = 8`

**JavaScript:**
- No formal validation library used
- Input checks via conditionals
- Example: `if (!response.ok) { ... }`
- DOM-level validation (type="email", required, etc.)

---

*Conventions analysis: 2026-03-03*
