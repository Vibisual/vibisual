// Test-only. Loaded into the Electron main process ahead of the app with Electron's `-r` switch (harness.ts), so
// Playwright's evaluate() can reach Node modules — its function runs without `require` in scope.
globalThis.__vibE2eRequire = require;
