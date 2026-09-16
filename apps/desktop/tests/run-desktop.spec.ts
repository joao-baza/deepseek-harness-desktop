import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const launcher = fileURLToPath(new URL('../run-desktop.sh', import.meta.url))
const temporaryRoots: string[] = []

type Fixture = {
  root: string
  home: string
  entry: string
  calls: string
  notifications: string
  log: string
}

async function createFixture(options: {
  entry?: boolean
  buildResult?: 'success' | 'failure'
  buildCreatesEntry?: boolean
  notifyResult?: 'success' | 'failure'
} = {}): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-launcher-'))
  temporaryRoots.push(root)
  const home = join(root, 'home')
  const bin = join(home, '.local', 'bin')
  const desktop = join(root, 'apps', 'desktop')
  const entry = join(root, 'apps', 'web', 'dist', 'index.html')
  const calls = join(root, 'pnpm-calls.log')
  const notifications = join(root, 'notify-calls.log')
  const log = join(root, 'state', 'deepseek-harness-desktop', 'launcher.log')
  await mkdir(bin, { recursive: true })
  await mkdir(desktop, { recursive: true })
  await writeFile(join(desktop, 'run-desktop.sh'), await readFile(launcher))
  await chmod(join(desktop, 'run-desktop.sh'), 0o755)
  if (options.entry) {
    await mkdir(join(root, 'apps', 'web', 'dist'), { recursive: true })
    await writeFile(entry, 'existing')
  }

  const fakePnpm = `#!/usr/bin/env bash
set -u
printf '%s\\n' "$*" >> "${calls}"
if [[ "$*" == "run build:web" ]]; then
  ${options.buildResult === 'failure' ? 'exit 23' : options.buildCreatesEntry ? `mkdir -p "$(dirname "${entry}")"; printf 'built\\n' > "${entry}"` : ':'}
fi
exit 0
`
  await writeFile(join(bin, 'pnpm'), fakePnpm)
  await chmod(join(bin, 'pnpm'), 0o755)
  const fakeNotify = `#!/usr/bin/env bash
set -u
printf '%s\\n' "$*" >> "${notifications}"
${options.notifyResult === 'failure' ? 'exit 7' : 'exit 0'}
`
  await writeFile(join(bin, 'notify-send'), fakeNotify)
  await chmod(join(bin, 'notify-send'), 0o755)
  return { root, home, entry, calls, notifications, log }
}

function run(fixture: Fixture) {
  const bin = join(fixture.home, '.local', 'bin')
  return spawnSync('bash', [join(fixture.root, 'apps/desktop/run-desktop.sh')], {
    cwd: fixture.root,
    env: {
      ...process.env,
      HOME: fixture.home,
      PATH: `${bin}:/usr/bin:/bin`,
      XDG_STATE_HOME: join(fixture.root, 'state'),
    },
    encoding: 'utf8',
    timeout: 10_000,
  })
}

async function callsOf(fixture: Fixture) {
  try {
    return (await readFile(fixture.calls, 'utf8')).trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

async function notificationsOf(fixture: Fixture) {
  try {
    return (await readFile(fixture.notifications, 'utf8')).trim().split('\n').filter(Boolean)
  } catch {
    return []
  }
}

const desktopLauncherSuite = process.platform === 'linux' ? describe : describe.skip

desktopLauncherSuite('desktop launcher build preflight', () => {
  afterEach(async () => {
    await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
  })

  it('invokes only dsh:desktop when the web entry already exists', async () => {
    const fixture = await createFixture({ entry: true })
    const result = run(fixture)
    expect(result.status).toBe(0)
    expect(await callsOf(fixture)).toEqual(['dsh:desktop'])
  })

  it('builds the web app before launching when the entry is missing', async () => {
    const fixture = await createFixture({ buildCreatesEntry: true })
    const result = run(fixture)
    expect(result.status).toBe(0)
    expect(await callsOf(fixture)).toEqual(['run build:web', 'dsh:desktop'])
    await expect(readFile(fixture.entry, 'utf8')).resolves.toContain('built')
  })

  it('returns the build status and does not launch after a failed build', async () => {
    const fixture = await createFixture({ buildResult: 'failure', notifyResult: 'failure' })
    const result = run(fixture)
    expect(result.status).toBe(23)
    expect(await callsOf(fixture)).toEqual(['run build:web'])
    expect(await notificationsOf(fixture)).toEqual([
      expect.stringContaining('Could not build the web frontend (exit 23).'),
    ])
    expect(await readFile(fixture.log, 'utf8')).toContain('Could not build the web frontend (exit 23).')
  })

  it('returns 1 when a successful build produces no entry', async () => {
    const fixture = await createFixture()
    const result = run(fixture)
    expect(result.status).toBe(1)
    expect(await callsOf(fixture)).toEqual(['run build:web'])
    expect(await notificationsOf(fixture)).toEqual([
      expect.stringContaining('Web frontend build completed, but apps/web/dist/index.html is still missing.'),
    ])
    expect(await readFile(fixture.log, 'utf8')).toContain('web frontend missing; running pnpm run build:web')
  })
})
