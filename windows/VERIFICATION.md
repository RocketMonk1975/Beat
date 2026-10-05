# Prototype 0.1.0 verification

Verified on Windows on 2026-10-05.

- TypeScript compile check and Electron main/preload JavaScript syntax checks: passed.
- Parser and document tests: 10 passed.
- Real Electron desktop checks: 13 passed, with no recorded errors.
- Dependency audit: zero vulnerabilities reported at verification time.
- Portable Windows x64 application: packaged; required main, preload, renderer, document and styling files present in the archive. Development tests and node_modules are excluded from the bundle.

Desktop checks covered isolated preload, controls, navigation, editing, live formatting, filtering, file save, cancelled operations, undo/redo, external-file conflict protection, fresh document history, opaque metadata round-trips and blocked edits, copies preserving originals, invalid UTF-8, and the upstream Big Fish sample (192 scenes).

The desktop test window was launched by the user from normal PowerShell. It could not run within the Codex execution sandbox because Windows rejected Electron's restricted token when reading its runtime. Electron's sandbox remained enabled. Native dialogs were replaced with deterministic test responses; the actual UI/file-I/O paths ran. Human interaction with the operating system's file-picker UI, a clean machine, installer behavior, and feature parity with native BEAT have not been verified.
