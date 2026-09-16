# Desktop launcher build preflight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** Make the Linux desktop launcher build the Web frontend automatically when its entry artifact is missing, preventing the Electron startup failure seen after a clean or cleaned checkout.

**Architecture:** Keep the recovery in \`apps/desktop/run-desktop.sh\`, which already owns the \`.desktop\` entry point, PATH setup, logging, and failure notification. The launcher checks the canonical \`apps/web/dist/index.html\`, runs only \`pnpm run build:web\` when that file is absent, validates that the build produced the file, and then delegates to the existing \`pnpm dsh:desktop\` command.

**Tech Stack:** Bash, pnpm workspace scripts, Vitest, Node.js filesystem/process helpers, Markdown documentation, and the repository Agent Note pairing workflow.

---

### Task 1: Add an isolated launcher regression suite

**Files:**
- Create: \`apps/desktop/tests/run-desktop.spec.ts\`
- Read: \`apps/desktop/run-desktop.sh\`

- [ ] **Step 1: Write the failing tests and fixture helper**

Create a temporary repository containing a copied launcher, a temporary \`HOME\`, and a fake \`pnpm\` at \`$HOME/.local/bin/pnpm\`. The fake command records its arguments, creates the Web entry only for \`run build:web\`, and can simulate a build failure or a successful build that omits the output.

\`\`\`ts
import { spawnSync } from 'node:child_process'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const sourceLauncher = fileURLToPath(new URL('../run-desktop.sh', import.meta.url))

type Fixture = {
  root: string
  repoRoot: string
  launcher: string
  home: string
  state: string
  pnpmLog: string
}

const fixtures: Fixture[] = []

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-launcher-'))
  const repoRoot = join(root, 'repo')
  const launcher = join(repoRoot, 'apps/desktop/run-desktop.sh')
  const home = join(root, 'home')
  const state = join(root, 'state')
  const pnpmBin = join(home, '.local/bin/pnpm')
  const pnpmLog = join(root, 'pnpm.log')

  await mkdir(join(repoRoot, 'apps/desktop'), { recursive: true })
  await mkdir(join(home, '.local/bin'), { recursive: true })
  await copyFile(sourceLauncher, launcher)
  await chmod(launcher, 0o755)
  await writeFile(pnpmBin, [
    '#!/usr/bin/env bash',
    'set -eu',
    'printf "%s\\n" "$*" >> "$FAKE_PNPM_LOG"',
    'case "$*" in',
    '  "run build:web")',
    '    if [ "\${FAKE_PNPM_FAIL_BUILD:-0}" = "1" ]; then exit 23; fi',
    '    if [ "\${FAKE_PNPM_SKIP_OUTPUT:-0}" != "1" ]; then',
    '      mkdir -p apps/web/dist',
    '      printf "<!doctype html>\\n" > apps/web/dist/index.html',
    '    fi',
    '    ;;',
    '  "dsh:desktop") ;;',
    '  *) exit 64 ;;',
    'esac',
  ].join('\\n'))
  await chmod(pnpmBin, 0o755)

  const fixture = { root, repoRoot, launcher, home, state, pnpmLog }
  fixtures.push(fixture)
  return fixture
}

function runLauncher(fixture: Fixture, extraEnv: Record<string, string> = {}) {
  return spawnSync(fixture.launcher, [], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: fixture.home,
      XDG_STATE_HOME: fixture.state,
      FAKE_PNPM_LOG: fixture.pnpmLog,
      ...extraEnv,
    },
  })
}

async function calls(fixture: Fixture): Promise<string[]> {
  return (await readFile(fixture.pnpmLog, 'utf8')).trim().split('\\n')
}

afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(({ root }) => rm(root, { recursive: true, force: true })))
})

describe('desktop launcher Web build preflight', () => {
  it('skips the build when the Web entry already exists', async () => {
    const fixture = await createFixture()
    await mkdir(join(fixture.repoRoot, 'apps/web/dist'), { recursive: true })
    await writeFile(join(fixture.repoRoot, 'apps/web/dist/index.html'), '<!doctype html>\\n')

    const result = runLauncher(fixture)

    expect(result.status).toBe(0)
    expect(await calls(fixture)).toEqual(['dsh:desktop'])
  })

  it('builds the Web entry before starting the desktop command when it is missing', async () => {
    const fixture = await createFixture()

    const result = runLauncher(fixture)

    expect(result.status).toBe(0)
    expect(await calls(fixture)).toEqual(['run build:web', 'dsh:desktop'])
    await expect(readFile(join(fixture.repoRoot, 'apps/web/dist/index.html'), 'utf8')).resolves.toContain('<!doctype html>')
  })

  it('does not start Electron when the Web build fails', async () => {
    const fixture = await createFixture()

    const result = runLauncher(fixture, { FAKE_PNPM_FAIL_BUILD: '1' })

    expect(result.status).toBe(23)
    expect(await calls(fixture)).toEqual(['run build:web'])
  })

  it('does not start Electron when the build exits successfully without producing the entry', async () => {
    const fixture = await createFixture()

    const result = runLauncher(fixture, { FAKE_PNPM_SKIP_OUTPUT: '1' })

    expect(result.status).toBe(1)
    expect(await calls(fixture)).toEqual(['run build:web'])
  })
})
\`\`\`

- [ ] **Step 2: Run the focused suite to verify the new behavior fails before implementation**

Run: \`pnpm exec vitest run apps/desktop/tests/run-desktop.spec.ts\`

Expected: the existing-entry test passes, while the missing-entry, failed-build, and missing-output tests fail because the current launcher calls only \`dsh:desktop\`.

### Task 2: Implement the missing-artifact preflight

**Files:**
- Modify: \`apps/desktop/run-desktop.sh:26\`

- [ ] **Step 1: Add the preflight after changing to the repository root**

Keep the existing \`pnpm\` lookup and \`cd\` unchanged. Immediately after the \`cd\`, add this block before \`exec pnpm dsh:desktop\`:

\`\`\`bash
web_dist_entry='apps/web/dist/index.html'
if [ ! -f "$web_dist_entry" ]; then
  echo "frontend dist missing at $web_dist_entry; running pnpm run build:web"
  if pnpm run build:web; then
    if [ ! -f "$web_dist_entry" ]; then
      echo "frontend build completed but $web_dist_entry was not created"
      if command -v notify-send >/dev/null 2>&1; then
        notify-send "DeepSeek Harness" "Could not launch: Web frontend build produced no entry. See $LOG_DIR/launcher.log" || true
      fi
      exit 1
    fi
  else
    build_status=$?
    echo "frontend build failed with exit status $build_status"
    if command -v notify-send >/dev/null 2>&1; then
      notify-send "DeepSeek Harness" "Could not launch: Web frontend build failed. See $LOG_DIR/launcher.log" || true
    fi
    exit "$build_status"
  fi
fi
\`\`\`

This preserves the original command when the entry exists, runs only the frontend build when it is absent, retains the build's nonzero status, and fails closed if a successful command did not create the artifact.

- [ ] **Step 2: Run the focused suite and verify all four cases pass**

Run: \`pnpm exec vitest run apps/desktop/tests/run-desktop.spec.ts\`

Expected: four tests pass with zero failures.

### Task 3: Document and record the shipped behavior

**Files:**
- Modify: \`README.md:59\`
- Modify: \`.agents/notes/implemented/simplification/2026-08-12-separate-source-launch-from-build.md\`
- Modify: \`.agents/notes/implemented/simplification/2026-08-12-separate-source-launch-from-build.zh.md\`
- Modify: \`.agents/notes/implemented/simplification/2026-08-12-separate-source-launch-from-build.i18n.yaml\`

- [ ] **Step 1: Document the launcher recovery in \`README.md\`**

Add one paragraph after the \`pnpm dsh:desktop\` code block: “The Linux desktop launcher automatically runs \`pnpm run build:web\` when \`apps/web/dist/index.html\` is missing; an existing Web build is reused.”

- [ ] **Step 2: Update the existing implemented Agent Note in both languages**

Keep the note’s decision and alternatives intact, but update its current-state facts: the Linux desktop launcher owns a missing-frontend preflight, invokes \`pnpm run build:web\` only when the entry is absent, validates the output, and still accepts existing stale artifacts. Update the consequences and verification sections to name \`apps/desktop/tests/run-desktop.spec.ts\` and the real launcher smoke. Keep the Chinese counterpart structurally aligned and re-record the pair with the repository command.

- [ ] **Step 3: Re-record and check the Agent Note pair**

Run: \`pnpm run verify-translation-pairing --write .agents/notes/implemented/simplification/2026-08-12-separate-source-launch-from-build.md\`

Expected: the command updates the sidecar hashes and exits with status 0.

### Task 4: Verify the real launcher recovery

**Files:**
- Verify: \`apps/desktop/run-desktop.sh\`
- Verify: \`apps/web/dist/index.html\`

- [ ] **Step 1: Remove only the generated Web entry artifact**

Run: \`rm -f apps/web/dist/index.html\`

Expected: \`test ! -e apps/web/dist/index.html\` succeeds; no source or tracked file is removed.

- [ ] **Step 2: Start the launcher through the same desktop-entry helper**

Run: \`setsid apps/desktop/run-desktop.sh >/dev/null 2>&1 < /dev/null &\`

Expected: the process remains alive and the launcher log records \`pnpm run build:web\`, followed by \`dsh web: http://127.0.0.1:<port>\`.

- [ ] **Step 3: Confirm the rebuilt endpoint**

Run: \`url=$(sed -n 's/^dsh web: //p' "\${XDG_STATE_HOME:-$HOME/.local/state}/deepseek-harness-desktop/launcher.log" | tail -n 1); test -n "$url"; curl --silent --show-error --output /tmp/deepseek-harness-index.html --write-out '%{http_code}\\n' "$url"\`

Expected: \`200\`, the generated \`apps/web/dist/index.html\` exists, and the Electron process has a renderer child.

### Task 5: Run scoped repository checks and commit the implementation

**Files:**
- Stage only the launcher, test, README, Agent Note pair, and the sidecar.

- [ ] **Step 1: Run formatting and focused checks**

Run: \`git diff --check\`, \`pnpm exec vitest run apps/desktop/tests/run-desktop.spec.ts\`, and \`pnpm run verify-agent-note-format -- .agents/notes/implemented/simplification/2026-08-12-separate-source-launch-from-build.md\`.

Expected: all commands exit 0.

- [ ] **Step 2: Inspect the staged scope**

Run: \`git status --short\` and \`git diff --stat\`.

Expected: only the planned launcher, test, README, and Agent Note files are changed; \`apps/web/dist/\` remains ignored and unstaged.

- [ ] **Step 3: Commit the implementation**

\`\`\`bash
git add apps/desktop/run-desktop.sh apps/desktop/tests/run-desktop.spec.ts README.md \\
  .agents/notes/implemented/simplification/2026-08-12-separate-source-launch-from-build.md \\
  .agents/notes/implemented/simplification/2026-08-12-separate-source-launch-from-build.zh.md \\
  .agents/notes/implemented/simplification/2026-08-12-separate-source-launch-from-build.i18n.yaml
git diff --cached --check
git commit -m "fix: build desktop web frontend when missing"
\`\`\`

Expected: the commit succeeds with the pre-commit hooks green and no generated build output included.
