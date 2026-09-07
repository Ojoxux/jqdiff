import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// @ts-expect-error 型定義のない fixture サーバを直接読む
import { startFixtureServer } from '../fixture/server.mjs'

let server: { url: string; close: () => Promise<void> }

beforeAll(async () => {
  server = await startFixtureServer(0)
})
afterAll(() => server.close())

describe('fixture server', () => {
  it('jQuery 版は jquery と app.jquery.js を読み込む', async () => {
    const html = await (await fetch(`${server.url}/jquery`)).text()
    expect(html).toContain('/vendor/jquery.js')
    expect(html).toContain('/app.jquery.js')
    expect(html).not.toContain('/app.native.js')
  })

  it('native 版は jquery を読み込まない', async () => {
    const html = await (await fetch(`${server.url}/native`)).text()
    expect(html).toContain('/app.native.js')
    expect(html).not.toContain('/vendor/jquery.js')
  })

  it('両版の body は完全に一致する(HTML は移行で変わらない前提)', async () => {
    // script を落とすと版によって空白の残り方が変わるので、空白も畳んで比べる。
    // 見たいのは「マークアップが同一か」であって整形の一致ではない。
    const strip = (html: string) =>
      html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/\s+/g, ' ').trim()
    const a = strip(await (await fetch(`${server.url}/jquery`)).text())
    const b = strip(await (await fetch(`${server.url}/native`)).text())
    expect(a).toBe(b)
  })

  it('/api/save は 200、/api/fail は 500 を返す', async () => {
    expect((await fetch(`${server.url}/api/save`, { method: 'POST' })).status).toBe(200)
    expect((await fetch(`${server.url}/api/fail`, { method: 'POST' })).status).toBe(500)
  })

  it('jquery 本体を配信できる', async () => {
    const res = await fetch(`${server.url}/vendor/jquery.js`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('jQuery')
  })
})
