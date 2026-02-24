/**
 * Global setup for Vitest. Mocks or stubs used across tests.
 */
if (typeof globalThis.indexedDB === 'undefined') {
  globalThis.indexedDB = {
    open(name, version) {
      const req = {};
      queueMicrotask(() => {
        req.result = {};
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
  };
}
