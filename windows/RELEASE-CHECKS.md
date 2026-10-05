# BEAT Windows 0.11.0 release checks

This is an unsigned development release, prepared without a signing certificate at the user's request.

## Automated validation

- TypeScript and JavaScript syntax checks.
- 98 core tests covering parser, source protection, local API, recovery/backups, native metadata/UUIDs, tag/review changes, revision decisions, metadata scene moves, print layout, a 1,000-scene edit and installer payload/hash/traversal checks.
- All 49 desktop checks passed against the real isolated Electron editor in normal PowerShell. The recorded results identify version 0.11.0 and contain no errors; the shared launcher now uses this verified release.
- Installer payload SHA-256 verification, safe archive entry validation and workspace-only install checks. Per-user installation and the Start menu shortcut require a normal Windows session.

## Build and install

`npm run package:installer` builds the portable application and its script-based per-user installer. Keep all files in the Installer directory together and run Install BEAT Windows.cmd. Installing a version already present reports an error; an upgrade installs into a new version directory and retains existing data. Uninstall keeps user data and requires BEAT to be closed.

The installer also accepts `-ValidateOnly`, or `-Destination <absolute directory> -SkipShortcut` for an isolated installation test. It verifies the payload before writing. It does not migrate the development launcher's user-data folder.

## External verification before wider distribution

- Run all desktop tests and inspect the new screenshots and PDFs.
- Test first install, upgrade from a different version, the Start menu shortcut and uninstall in a normal user account. Inspect recovery data retention after an upgrade.
- Test native macOS BEAT round trips and installed Final Draft interoperability. The Windows environment cannot execute those applications.
- Inspect print output for production scripts and non-Latin fonts. Exact native pagination and custom print-style parity are not claimed.
- Check keyboard navigation, screen reader announcements and high-contrast mode on Windows. Automated labels/focus checks are included; no formal WCAG certification is claimed.
- Signing and reputation distribution remain omitted by request. No signing key is bundled and no security controls are disabled globally.

Active plugin metadata, unknown native fields and changed-index metadata remain protected rather than silently rewritten. Plugins are not executed. The shipped modules are available without claiming full native application parity.
