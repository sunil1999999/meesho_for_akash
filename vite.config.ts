import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { spawn, execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { createAuthMiddleware } from './src/server/authMiddleware.ts'
import { AuthService } from './src/server/auth.ts'

function getPythonCmd(): string {
  if (process.platform === 'win32') return 'python'
  try {
    execSync('python3 --version', { stdio: 'ignore' })
    return 'python3'
  } catch {
    return 'python'
  }
}

function parseEnv(filePath: string): Record<string, string> {
  const res: Record<string, string> = {}
  if (!fs.existsSync(filePath)) return res
  const lines = fs.readFileSync(filePath, 'utf8').split('\n')
  for (const line of lines) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/)
    if (m) {
      let val = m[2] || ''
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      res[m[1]] = val.trim()
    }
  }
  return res
}

let monitorProc: any = null
let monitorLogs: string[] = []
let monitorExitCode: number | null = null

function telegramBridgePlugin(): Plugin {
  const middleware = async (req: any, res: any, next: any) => {
    const envPath = path.resolve(process.cwd(), '.env')
    const currentEnv = { ...parseEnv(envPath), ...process.env }
    const urlPath = (req.url || '').split('?')[0]

    if (urlPath === '/monitor-status' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json')
      const isRunning = Boolean(monitorProc && !monitorProc.killed && monitorProc.exitCode === null)
      res.end(JSON.stringify({
        is_running: isRunning,
        pid: isRunning ? monitorProc.pid : null,
        exit_code: monitorExitCode,
        recent_logs: monitorLogs.slice(-40)
      }))
      return
    }

    if (urlPath === '/monitor-start' && req.method === 'POST') {
      if (monitorProc && !monitorProc.killed && monitorProc.exitCode === null) {
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ success: true, running: true, pid: monitorProc.pid, message: 'Continuous monitor is already running.' }))
        return
      }
      try {
        monitorLogs = []
        monitorExitCode = null
        const scriptPath = path.resolve(process.cwd(), 'continuous_order_monitor.py')
        const pythonCmd = getPythonCmd()
        console.log(`[Vite Server] Spawning continuous monitor with command: ${pythonCmd} ${scriptPath}`)

        monitorProc = spawn(pythonCmd, ['-u', scriptPath], {
          cwd: process.cwd(),
          env: { ...process.env, ...currentEnv, PYTHONUNBUFFERED: '1' }
        })

        monitorProc.on('error', (err: any) => {
          const errLine = `[Worker failed to start: ${err.message}]`
          console.error('[Monitor Error]', errLine)
          monitorLogs.push(errLine)
          monitorProc = null
        })

        monitorProc.stdout.on('data', (d: Buffer) => {
          const text = d.toString()
          console.log('[Monitor stdout]', text.trimEnd())
          const lines = text.split('\n').filter(Boolean)
          monitorLogs.push(...lines)
          if (monitorLogs.length > 300) monitorLogs = monitorLogs.slice(-300)
        })

        monitorProc.stderr.on('data', (d: Buffer) => {
          const text = d.toString()
          console.error('[Monitor stderr]', text.trimEnd())
          const lines = text.split('\n').filter(Boolean)
          monitorLogs.push(...lines)
          if (monitorLogs.length > 300) monitorLogs = monitorLogs.slice(-300)
        })

        monitorProc.on('exit', (code: number) => {
          monitorExitCode = code
          const exitLine = `[Worker exited with code ${code}]`
          console.log('[Monitor Exit]', exitLine)
          monitorLogs.push(exitLine)
          monitorProc = null
        })

        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ success: true, running: true, pid: monitorProc.pid, message: 'Continuous monitor started successfully.' }))
      } catch (err: any) {
        console.error('[Monitor Spawn Error]', err)
        res.statusCode = 500
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ success: false, error: err?.message }))
      }
      return
    }

    if (urlPath === '/monitor-stop' && req.method === 'POST') {
      if (monitorProc && !monitorProc.killed && monitorProc.exitCode === null) {
        try {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/pid', monitorProc.pid.toString(), '/f', '/t'])
          } else {
            monitorProc.kill('SIGTERM')
          }
        } catch (e: any) {
          console.error('[Monitor Stop Error]', e)
        }
        monitorProc = null
      }
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ success: true, running: false, message: 'Continuous monitor stopped.' }))
      return
    }

    if (urlPath === '/status' && req.method === 'GET') {
      res.setHeader('Content-Type', 'application/json')
      const configured = Boolean(
        currentEnv.TELEGRAM_API_ID &&
        currentEnv.TELEGRAM_API_HASH &&
        currentEnv.TELEGRAM_STRING_SESSION
      )
      res.end(JSON.stringify({
        configured,
        api_id: currentEnv.TELEGRAM_API_ID ? 'configured' : null,
        api_hash: currentEnv.TELEGRAM_API_HASH ? 'configured' : null,
        has_session: Boolean(currentEnv.TELEGRAM_STRING_SESSION),
        bot_username: currentEnv.TELEGRAM_BOT_USERNAME || 'primes_meesho_bot'
      }))
      return
    }

    if (urlPath === '/save-credentials' && req.method === 'POST') {
          let body = ''
          req.on('data', (chunk: any) => { body += chunk })
          req.on('end', () => {
            try {
              const { api_id, api_hash, string_session } = JSON.parse(body)
              const envPath = path.resolve(process.cwd(), '.env')
              let envContent = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''

              const updateOrAppend = (key: string, val: string) => {
                const regex = new RegExp(`^${key}=.*$`, 'm')
                if (regex.test(envContent)) {
                  envContent = envContent.replace(regex, `${key}=${val}`)
                } else {
                  envContent += `\n${key}=${val}`
                }
              }

              if (api_id) updateOrAppend('TELEGRAM_API_ID', api_id)
              if (api_hash) updateOrAppend('TELEGRAM_API_HASH', api_hash)
              if (string_session) updateOrAppend('TELEGRAM_STRING_SESSION', string_session)

              fs.writeFileSync(envPath, envContent.trim() + '\n', 'utf8')
              if (api_id) process.env.TELEGRAM_API_ID = api_id
              if (api_hash) process.env.TELEGRAM_API_HASH = api_hash
              if (string_session) process.env.TELEGRAM_STRING_SESSION = string_session

              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: true, message: 'Telegram credentials saved to .env' }))
            } catch (err: any) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ success: false, error: err?.message }))
            }
          })
          return
        }

    if (urlPath === '/run' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk: any) => { body += chunk })
      req.on('end', async () => {
        try {
          const data = JSON.parse(body)
          const { account_id, mobile, session_json, api_id, api_hash, session_str } = data

          // Temporary session json file in scratch directory
          const scratchDir = path.resolve(process.cwd(), 'scratch')
          if (!fs.existsSync(scratchDir)) fs.mkdirSync(scratchDir, { recursive: true })
          const tempJsonPath = path.resolve(scratchDir, `session_${Date.now()}.json`)
          fs.writeFileSync(tempJsonPath, JSON.stringify(session_json || {}), 'utf8')

          res.setHeader('Content-Type', 'text/event-stream')
          res.setHeader('Cache-Control', 'no-cache')
          res.setHeader('Connection', 'keep-alive')

          const args = [
            path.resolve(process.cwd(), 'telegram_bot_live_sync.py'),
            '--account-id', account_id,
            '--mobile', mobile,
            '--session-json', tempJsonPath
          ]
          if (api_id) args.push('--api-id', api_id)
          if (api_hash) args.push('--api-hash', api_hash)
          if (session_str) args.push('--session-str', session_str)

          const pythonCmd = getPythonCmd()
          const pyProc = spawn(pythonCmd, args, {
            cwd: process.cwd(),
            env: { ...process.env, ...currentEnv, PYTHONUNBUFFERED: '1' }
          })

              pyProc.on('error', (err: any) => {
                res.write(`data: ${JSON.stringify({ type: 'ERROR', text: `Failed to spawn Python process: ${err.message}` })}\n\n`)
                try { if (fs.existsSync(tempJsonPath)) fs.unlinkSync(tempJsonPath) } catch {}
                res.end()
              })

              let reportJson = ''
              let capturingReport = false

              pyProc.stdout.on('data', chunk => {
                const text = chunk.toString()
                const lines = text.split('\n')
                for (const line of lines) {
                  const trimmed = line.trim()
                  if (trimmed === '---WORKFLOW_REPORT_START---') {
                    capturingReport = true
                    continue
                  }
                  if (trimmed === '---WORKFLOW_REPORT_END---') {
                    capturingReport = false
                    try {
                      const rep = JSON.parse(reportJson)
                      res.write(`data: ${JSON.stringify({ type: 'REPORT', report: rep })}\n\n`)
                    } catch {}
                    continue
                  }
                  if (capturingReport) {
                    reportJson += trimmed
                  } else if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                    try {
                      const parsed = JSON.parse(trimmed)
                      res.write(`data: ${JSON.stringify({ type: 'LOG', ...parsed })}\n\n`)
                    } catch {
                      res.write(`data: ${JSON.stringify({ type: 'RAW', text: trimmed })}\n\n`)
                    }
                  } else if (trimmed) {
                    res.write(`data: ${JSON.stringify({ type: 'RAW', text: trimmed })}\n\n`)
                  }
                }
              })

              pyProc.stderr.on('data', chunk => {
                res.write(`data: ${JSON.stringify({ type: 'ERROR', text: chunk.toString().trim() })}\n\n`)
              })

              pyProc.on('close', code => {
                try { if (fs.existsSync(tempJsonPath)) fs.unlinkSync(tempJsonPath) } catch {}
                res.write(`data: ${JSON.stringify({ type: 'DONE', exitCode: code })}\n\n`)
                res.end()
              })

              req.on('close', () => {
                pyProc.kill()
                try { if (fs.existsSync(tempJsonPath)) fs.unlinkSync(tempJsonPath) } catch {}
              })
            } catch (err: any) {
              res.statusCode = 500
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: err?.message }))
            }
          })
          return
        }

        next()
  }

  return {
    name: 'telegram-bridge-plugin',
    configureServer(server) {
      server.middlewares.use('/api/telegram', middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/telegram', middleware)
    }
  }
}

function checkoutBridgePlugin(): Plugin {
  const checkoutMiddleware = async (req: any, res: any, next: any) => {
    const urlPath = (req.url || '').split('?')[0]

    const actionMap: Record<string, string> = {
      '/resolve': 'resolve-product',
      '/search': 'search-products',
      '/accounts': 'get-accounts',
      '/select-account': 'select-account',
      '/addresses': 'get-addresses',
      '/addresses/create': 'create-address',
      '/addresses/bulk-add': 'bulk-add-address',
      '/refresh-session': 'refresh-session',
      '/sessions/bulk-refresh': 'bulk-refresh-sessions',
      '/cart': 'get-cart',
      '/cart/add': 'add-to-cart',
      '/cart/auto-add': 'bulk-add-to-cart',
      '/cart/bulk-add': 'bulk-add-to-cart',
      '/cart/update': 'update-cart',
      '/cart/isolate': 'isolate-cart',
      '/cart/location': 'set-location',
      '/quote': 'get-quote',
      '/place-cod': 'place-cod',
      '/pay': 'pay-online',
      '/free-checkout': 'free-checkout',
      '/status': 'check-payment',
      '/confirm': 'confirm-order',
    }

    const action = actionMap[urlPath]
    if (!action) {
      return next()
    }

    res.setHeader('Content-Type', 'application/json')

    let rawBody = ''
    req.on('data', (chunk: any) => { rawBody += chunk })
    req.on('end', async () => {
      let body: any = {}
      try {
        if (rawBody.trim()) {
          body = JSON.parse(rawBody)
        }
      } catch (e) {
        res.statusCode = 400
        res.end(JSON.stringify({ success: false, error: 'Malformed JSON request body' }))
        return
      }

      try {
        const pythonCmd = getPythonCmd()
        const bridgePath = path.resolve(process.cwd(), 'meesho_checkout_bridge.py')
        const envPath = path.resolve(process.cwd(), '.env')
        const currentEnv = { ...parseEnv(envPath), ...process.env }

        const pyProc = spawn(pythonCmd, ['-u', bridgePath, action, '--payload', JSON.stringify(body)], {
          cwd: process.cwd(),
          env: { ...process.env, ...currentEnv, PYTHONUNBUFFERED: '1' }
        })

        let stdout = ''
        let stderr = ''

        pyProc.stdout.on('data', d => { stdout += d.toString() })
        pyProc.stderr.on('data', d => { stderr += d.toString() })

        pyProc.on('close', code => {
          if (code !== 0 && !stdout.trim()) {
            res.statusCode = 500
            res.end(JSON.stringify({ success: false, error: stderr.trim() || `Bridge exited with code ${code}` }))
            return
          }
          try {
            const parsed = JSON.parse(stdout.trim())
            if (parsed.success === false && parsed.status_code) {
              res.statusCode = parsed.status_code
            }
            res.end(JSON.stringify(parsed))
          } catch (e) {
            res.statusCode = 500
            res.end(JSON.stringify({ success: false, error: stdout.trim() || stderr.trim() || 'Invalid bridge response' }))
          }
        })

        pyProc.on('error', err => {
          res.statusCode = 500
          res.end(JSON.stringify({ success: false, error: `Failed to spawn checkout bridge: ${err.message}` }))
        })
      } catch (err: any) {
        res.statusCode = 500
        res.end(JSON.stringify({ success: false, error: err?.message }))
      }
    })
  }

  return {
    name: 'checkout-bridge-plugin',
    configureServer(server) {
      server.middlewares.use('/api/checkout', checkoutMiddleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/checkout', checkoutMiddleware)
    }
  }
}

function accountRefreshPlugin(): Plugin {
  const refreshMiddleware = async (req: any, res: any, next: any) => {
    const urlPath = (req.url || '').split('?')[0]

    if (urlPath === '/refresh-json' && req.method === 'POST') {
      res.setHeader('Content-Type', 'application/json')

      let rawBody = ''
      req.on('data', (chunk: any) => { rawBody += chunk })
      req.on('end', async () => {
        let body: any = {}
        try {
          if (rawBody.trim()) {
            body = JSON.parse(rawBody)
          }
        } catch {
          res.statusCode = 400
          res.end(JSON.stringify({ success: false, status: 'FAILED', display_status: 'Failed', message: 'Malformed JSON payload' }))
          return
        }

        const { account_id, mobile, account_json } = body
        if (!account_id && !mobile) {
          res.statusCode = 400
          res.end(JSON.stringify({ success: false, status: 'FAILED', display_status: 'Failed', message: 'Missing account identifier (account_id or mobile)' }))
          return
        }

        try {
          const pythonCmd = getPythonCmd()
          const scriptPath = path.resolve(process.cwd(), 'scripts', 'refresh_single_account.py')
          const envPath = path.resolve(process.cwd(), '.env')
          const currentEnv = { ...parseEnv(envPath), ...process.env }

          const pyProc = spawn(pythonCmd, ['-u', scriptPath, '--payload', JSON.stringify({ account_id, mobile, account_json })], {
            cwd: process.cwd(),
            env: { ...process.env, ...currentEnv, PYTHONUNBUFFERED: '1' }
          })

          let stdout = ''
          let stderr = ''

          pyProc.stdout.on('data', d => { stdout += d.toString() })
          pyProc.stderr.on('data', d => { stderr += d.toString() })

          pyProc.on('close', code => {
            if (code !== 0 && !stdout.trim()) {
              res.statusCode = 500
              res.end(JSON.stringify({ success: false, status: 'FAILED', display_status: 'Failed', message: stderr.trim() || ('Refresh exited with code ' + code) }))
              return
            }
            try {
              const parsed = JSON.parse(stdout.trim())
              res.end(JSON.stringify(parsed))
            } catch {
              res.statusCode = 500
              res.end(JSON.stringify({ success: false, status: 'FAILED', display_status: 'Failed', message: stdout.trim() || stderr.trim() || 'Invalid response from refresh script' }))
            }
          })

          pyProc.on('error', err => {
            res.statusCode = 500
            res.end(JSON.stringify({ success: false, status: 'FAILED', display_status: 'Failed', message: ('Failed to execute refresh script: ' + err.message) }))
          })
        } catch (err: any) {
          res.statusCode = 500
          res.end(JSON.stringify({ success: false, status: 'FAILED', display_status: 'Failed', message: err?.message || 'Internal server error' }))
        }
      })
      return
    }

    next()
  }

  return {
    name: 'account-refresh-plugin',
    configureServer(server) {
      server.middlewares.use('/api/accounts', refreshMiddleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/accounts', refreshMiddleware)
    }
  }
}

function authPlugin(): Plugin {
  const envPath = path.resolve(process.cwd(), '.env')
  const env = parseEnv(envPath)
  Object.assign(process.env, env)
  const service = new AuthService({
    adminUsername: env.ADMIN_USERNAME || process.env.ADMIN_USERNAME || 'admin',
    adminPasswordHash: env.ADMIN_PASSWORD_HASH || process.env.ADMIN_PASSWORD_HASH,
    sessionSecret: env.SESSION_SECRET || process.env.SESSION_SECRET,
  })
  const middleware = createAuthMiddleware(service)
  return {
    name: 'auth-plugin',
    configureServer(server) {
      server.middlewares.use(middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware)
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [authPlugin(), react(), tailwindcss(), telegramBridgePlugin(), checkoutBridgePlugin(), accountRefreshPlugin()],
  preview: {
    host: '0.0.0.0',
    port: parseInt(process.env.PORT || '8080', 10),
    allowedHosts: true,
  },
  // @ts-ignore
  test: {
    testTimeout: 20000,
  },
})
