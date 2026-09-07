import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createState } from '../../src/probe/state.js'
import { installNetworkRecorder } from '../../src/probe/network.js'
import type { ProbeState } from '../../src/probe/state.js'

class FakeXhr extends EventTarget {
  status = 0
  open(_method: string, _url: string): void {}
  setRequestHeader(_name: string, _value: string): void {}
  send(_body?: unknown): void {}
  finish(status: number): void {
    this.status = status
    this.dispatchEvent(new Event('loadend'))
  }
}

let state: ProbeState
let dispose: () => void
let lastRequest: Request | null

beforeEach(() => {
  lastRequest = null
  ;(globalThis as Record<string, unknown>).XMLHttpRequest = FakeXhr
  ;(globalThis as Record<string, unknown>).fetch = async (input: RequestInfo, init?: RequestInit) => {
    lastRequest = new Request(input, init)
    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
  }
  state = createState(
    { generatedIdPatterns: [], styleProps: [] },
    { url: 'http://x/', scenarioId: 's', startedAt: '2026-01-01T00:00:00Z' },
  )
  dispose = installNetworkRecorder(state)
})

afterEach(() => dispose())

describe('XHR の記録', () => {
  it('method / url / ヘッダ / body を記録する', () => {
    const xhr = new (globalThis as unknown as { XMLHttpRequest: typeof FakeXhr }).XMLHttpRequest()
    xhr.open('post', '/api/save')
    xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest')
    xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded')
    xhr.send('title=hello')

    expect(state.pendingNetwork).toHaveLength(1)
    expect(state.pendingNetwork[0]).toMatchObject({
      transport: 'xhr',
      method: 'POST',
      url: '/api/save',
      body: 'title=hello',
      headers: {
        'x-requested-with': 'XMLHttpRequest',
        'content-type': 'application/x-www-form-urlencoded',
      },
    })
  })

  it('レスポンス到着後にステータスを埋める', () => {
    const xhr = new (globalThis as unknown as { XMLHttpRequest: typeof FakeXhr }).XMLHttpRequest()
    xhr.open('GET', '/api/x')
    xhr.send()
    expect(state.pendingNetwork[0]!.status).toBeNull()
    xhr.finish(500)
    expect(state.pendingNetwork[0]!.status).toBe(500)
    expect(state.pendingNetwork[0]!.ok).toBe(false)
  })
})

describe('fetch の記録', () => {
  it('method / url / ヘッダ / body / status を記録する', async () => {
    await globalThis.fetch('http://x/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"title":"hello"}',
    })
    // body は clone().text() 経由で非同期に埋まる
    await new Promise((r) => setTimeout(r, 0))

    expect(state.pendingNetwork).toHaveLength(1)
    expect(state.pendingNetwork[0]).toMatchObject({
      transport: 'fetch',
      method: 'POST',
      url: 'http://x/api/save',
      body: '{"title":"hello"}',
      status: 200,
      ok: true,
      headers: { 'content-type': 'application/json' },
    })
  })

  it('元の fetch にリクエストを渡す', async () => {
    await globalThis.fetch('http://x/api/x')
    expect(lastRequest?.url).toBe('http://x/api/x')
  })

  it('dispose すると元の実装に戻る', async () => {
    dispose()
    await globalThis.fetch('http://x/api/x')
    expect(state.pendingNetwork).toHaveLength(0)
  })
})
