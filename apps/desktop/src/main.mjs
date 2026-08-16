import { spawn } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog } from 'electron'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const readyPattern = /dsh web:\s+(http:\/\/127\.0\.0\.1:\d+)/
const nodeBinary = process.env.npm_node_execpath || (process.platform === 'win32' ? 'node.exe' : 'node')

let mainWindow = null
let webProcess = null
let webUrl = null
let isQuitting = false

function forwardLines(stream, onLine) {
  let buffer = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    buffer += chunk
    let lineEnd = buffer.indexOf('\n')
    while (lineEnd !== -1) {
      const line = buffer.slice(0, lineEnd)
      buffer = buffer.slice(lineEnd + 1)
      onLine(line)
      lineEnd = buffer.indexOf('\n')
    }
  })
}

function stopWebServer() {
  if (webProcess === null || webProcess.killed) return
  webProcess.kill('SIGTERM')
}

function startWebServer() {
  return new Promise((resolveUrl, reject) => {
    const child = spawn(
      nodeBinary,
      ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', 'web', '--port', '0'],
      {
        cwd: repoRoot,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    )
    webProcess = child

    let settled = false
    const timeout = setTimeout(() => {
      if (settled) return
      settled = true
      stopWebServer()
      reject(new Error('Timed out waiting for dsh web to print its local URL.'))
    }, 30_000)

    const settleWithUrl = (line) => {
      console.log(line)
      const match = readyPattern.exec(line)
      if (match === null || settled) return
      settled = true
      clearTimeout(timeout)
      resolveUrl(match[1])
    }

    forwardLines(child.stdout, settleWithUrl)
    forwardLines(child.stderr, line => console.error(line))

    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      if (settled) {
        if (!isQuitting) {
          void dialog.showMessageBox({
            type: 'error',
            title: 'DeepSeek Harness',
            message: 'DeepSeek Harness stopped unexpectedly.',
            detail: `dsh web exited (code ${code ?? 'null'}, signal ${signal ?? 'null'}).`,
          }).finally(() => app.quit())
        }
        return
      }
      settled = true
      clearTimeout(timeout)
      reject(new Error(`dsh web exited before startup completed (code ${code ?? 'null'}, signal ${signal ?? 'null'}).`))
    })
  })
}

async function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'DeepSeek Harness',
    backgroundColor: '#111318',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  await mainWindow.loadURL(url)
}

app.setName('DeepSeek Harness')

app.whenReady().then(async () => {
  try {
    webUrl = await startWebServer()
    await createMainWindow(webUrl)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await dialog.showMessageBox({
      type: 'error',
      title: 'DeepSeek Harness',
      message: 'Could not start DeepSeek Harness.',
      detail: message,
    })
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && webUrl !== null) {
    void createMainWindow(webUrl)
  }
})

app.on('before-quit', () => {
  isQuitting = true
  stopWebServer()
})

app.on('window-all-closed', () => {
  isQuitting = true
  stopWebServer()
  app.quit()
})
