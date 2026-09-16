# Desktop launcher build preflight

## Goal

The Linux desktop launcher must recover from a missing Web frontend build before starting Electron.

## Scope

The change is limited to `apps/desktop/run-desktop.sh`, its automated tests, and the relevant source-run documentation.

The Electron wrapper and the general `dsh web` command keep their existing startup behavior.

## Behavior

The launcher resolves `pnpm`, changes to the repository root, and checks `apps/web/dist/index.html`.

When the file exists, the launcher immediately executes `pnpm dsh:desktop` as it does today.

When the file is absent, the launcher logs that the Web frontend is being built and runs `pnpm run build:web`.

The launcher executes `pnpm dsh:desktop` only after the build command exits successfully.

If the build fails, the launcher exits with the build status and sends a desktop notification that points to its log when `notify-send` is available.

The existing `pnpm`-missing preflight remains unchanged.

## Design

The shell launcher owns this preflight because it is the entry point used by the `.desktop` file and already owns environment setup, logging, and error notification.

The check uses the canonical `apps/web/dist/index.html` path relative to the repository root, matching the Web bundle resolver that reports the current failure.

The build runs only for a missing entry file; an existing build is not rebuilt on every launch.

Build output remains in the ignored `apps/web/dist/` directory and is not committed.

## Testing

An isolated Vitest suite will execute a copied launcher against a temporary repository fixture and a fake `pnpm` executable.

The suite will prove that an existing entry file skips `build:web`, a missing entry file invokes `build:web` before `dsh:desktop`, and a failed build prevents the desktop command.

The implementation will also run the real launcher after removing the generated Web entry file, confirming that the automatic build restores the artifact and the desktop process reaches its local Web URL.

## Documentation

The source-run section of `README.md` will state that the desktop launcher automatically builds the Web frontend when its entry artifact is missing.
