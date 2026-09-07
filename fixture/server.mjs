import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = join(here, 'public')
const jqueryPath = join(here, '..', 'node_modules', 'jquery', 'dist', 'jquery.js')

const SCRIPTS = {
  jquery: '<script src="/vendor/jquery.js"></script>\n  <script src="/app.jquery.js"></script>',
  native: '<script src="/app.native.js"></script>',
}

const TYPES = { '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html' }

async function sendFile(res, path, type) {
  try {
    const body = await readFile(path)
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' })
    res.end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}

async function sendIndex(res, variant) {
  const html = await readFile(join(publicDir, 'index.html'), 'utf8')
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(html.replace('<!--SCRIPTS-->', SCRIPTS[variant]))
}

/** テストからもCLIからも使えるよう、ポート 0 で待ち受けて実際の URL を返す。 */
export function startFixtureServer(port = 0) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const path = url.pathname

    if (req.method === 'POST' && path === '/api/save') {
      res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
      return
    }
    if (req.method === 'POST' && path === '/api/fail') {
      res.writeHead(500, { 'content-type': 'application/json' }).end('{"error":"boom"}')
      return
    }

    if (path === '/jquery' || path === '/jquery/') return sendIndex(res, 'jquery')
    if (path === '/native' || path === '/native/') return sendIndex(res, 'native')
    if (path === '/vendor/jquery.js') return sendFile(res, jqueryPath, TYPES['.js'])

    if (/^\/(app\.(jquery|native)\.js|style\.css)$/.test(path)) {
      const ext = path.endsWith('.css') ? '.css' : '.js'
      return sendFile(res, join(publicDir, path.slice(1)), TYPES[ext])
    }

    res.writeHead(404).end('not found')
  })

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address()
      resolve({
        url: `http://127.0.0.1:${actual}`,
        close: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await startFixtureServer(3000)
  console.log(`fixture: ${url}/jquery  ${url}/native`)
}
