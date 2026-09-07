import type { NetworkEntry } from '../types.js'
import type { ProbeState } from './state.js'

type XhrMeta = { method: string; url: string; headers: Record<string, string> }

function installXhr(state: ProbeState): () => void {
  const Xhr = (globalThis as { XMLHttpRequest?: typeof XMLHttpRequest }).XMLHttpRequest
  if (!Xhr) return () => {}

  const proto = Xhr.prototype
  const origOpen = proto.open
  const origSend = proto.send
  const origSetHeader = proto.setRequestHeader
  const meta = new WeakMap<XMLHttpRequest, XhrMeta>()

  proto.open = function (
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    meta.set(this, { method: String(method).toUpperCase(), url: String(url), headers: {} })
    return (origOpen as unknown as (...a: unknown[]) => void).call(this, method, url, ...rest)
  } as typeof proto.open

  proto.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
    const m = meta.get(this)
    if (m) m.headers[String(name).toLowerCase()] = String(value)
    return origSetHeader.call(this, name, value)
  }

  proto.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const m = meta.get(this)
    if (m) {
      const entry: NetworkEntry = {
        transport: 'xhr',
        method: m.method,
        url: m.url,
        headers: m.headers,
        body: typeof body === 'string' ? body : body == null ? null : '[non-string body]',
        status: null,
        ok: false,
      }
      state.pendingNetwork.push(entry)
      // entry は参照で保持しているため、レスポンス到着時に後から埋められる。
      // checkpoint は networkidle 後に採られるので、その時点では確定している。
      this.addEventListener('loadend', () => {
        entry.status = this.status
        entry.ok = this.status >= 200 && this.status < 300
      })
    }
    return origSend.call(this, body ?? null)
  }

  return () => {
    proto.open = origOpen
    proto.send = origSend
    proto.setRequestHeader = origSetHeader
  }
}

function installFetch(state: ProbeState): () => void {
  const g = globalThis as { fetch?: typeof fetch; Request?: typeof Request }
  const origFetch = g.fetch
  const RequestCtor = g.Request
  if (!origFetch || !RequestCtor) return () => {}

  g.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    let request: Request
    try {
      request = new RequestCtor(input as RequestInfo, init)
    } catch {
      return origFetch.call(globalThis, input as RequestInfo, init)
    }

    const headers: Record<string, string> = {}
    request.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v
    })

    const entry: NetworkEntry = {
      transport: 'fetch',
      method: request.method.toUpperCase(),
      url: request.url,
      headers,
      body: null,
      status: null,
      ok: false,
    }
    state.pendingNetwork.push(entry)

    try {
      request
        .clone()
        .text()
        .then((t) => {
          entry.body = t === '' ? null : t
        })
        .catch(() => {})
    } catch {
      // body を読めない形式は null のままにする
    }

    return origFetch.call(globalThis, request).then((res) => {
      entry.status = res.status
      entry.ok = res.ok
      return res
    })
  } as typeof fetch

  return () => {
    g.fetch = origFetch
  }
}

/** XHR と fetch をラップする。戻り値を呼ぶと元に戻す。 */
export function installNetworkRecorder(state: ProbeState): () => void {
  const disposeXhr = installXhr(state)
  const disposeFetch = installFetch(state)
  return () => {
    disposeXhr()
    disposeFetch()
  }
}
