import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveConfig } from '../src/config.js'
import { runScenario } from '../src/runner/index.js'
import type { Scenario } from '../src/types.js'
// @ts-expect-error 型定義のない fixture サーバを直接読む
import { startFixtureServer } from '../fixture/server.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const probePath = join(root, 'dist', 'probe', 'index.global.js')
const config = resolveConfig({})

let server: { url: string; close: () => Promise<void> }

beforeAll(async () => {
  server = await startFixtureServer(0)
})
afterAll(() => server.close())

function scenario(steps: Scenario['steps']): Scenario {
  return {
    id: 'test',
    recordedAt: '2026-01-01T00:00:00Z',
    startUrl: '/',
    viewport: { width: 1280, height: 720 },
    steps,
  }
}

describe('runScenario', () => {
  it('初期ロードのチェックポイントとステップごとのチェックポイントを作る', async () => {
    const trace = await runScenario({
      url: `${server.url}/jquery`,
      scenario: scenario([{ index: 0, action: 'click', selector: '[data-testid="toggle-badge"]' }]),
      config,
      probePath,
    })

    expect(trace.checkpoints).toHaveLength(2)
    expect(trace.checkpoints[0]!.step).toBeNull()
    expect(trace.checkpoints[1]!.step?.selector).toBe('[data-testid="toggle-badge"]')
  })

  it('DOM の変更と computed style を記録する', async () => {
    const trace = await runScenario({
      url: `${server.url}/jquery`,
      scenario: scenario([{ index: 0, action: 'click', selector: '[data-testid="toggle-badge"]' }]),
      config,
      probePath,
    })

    const cp = trace.checkpoints[1]!
    expect(cp.mutations.length).toBeGreaterThan(0)
    expect(cp.styles['[data-testid="badge"]']?.display).toBe('none')
  })

  it('通信を記録する', async () => {
    const trace = await runScenario({
      url: `${server.url}/jquery`,
      scenario: scenario([
        { index: 0, action: 'input', selector: 'input[name="title"]', value: 'hello' },
        { index: 1, action: 'click', selector: '[data-testid="save-btn"]' },
      ]),
      config,
      probePath,
    })

    const network = trace.checkpoints.flatMap((c) => c.network)
    expect(network).toHaveLength(1)
    expect(network[0]).toMatchObject({ method: 'POST', status: 200 })
    expect(network[0]!.url).toContain('/api/save')
    expect(network[0]!.headers['x-requested-with']).toBe('XMLHttpRequest')
  })

  it('イベント伝播を記録する', async () => {
    const trace = await runScenario({
      url: `${server.url}/jquery`,
      scenario: scenario([{ index: 0, action: 'click', selector: '[data-testid="inner-link"]' }]),
      config,
      probePath,
    })

    const events = trace.checkpoints[1]!.events
    const click = events.find((e) => e.type === 'click')
    expect(click?.defaultPreventedAfter).toBe(true)
    expect(click?.propagationStoppedAfter).toBe(true)
  })

  it('解決できないセレクタは unresolved として記録し、実行は続ける', async () => {
    const trace = await runScenario({
      url: `${server.url}/jquery`,
      scenario: scenario([
        { index: 0, action: 'click', selector: '[data-testid="does-not-exist"]' },
        { index: 1, action: 'click', selector: '[data-testid="toggle-badge"]' },
      ]),
      config,
      probePath,
      stepTimeout: 1000,
    })

    expect(trace.checkpoints).toHaveLength(3)
    expect(trace.checkpoints[1]!.unresolved).toBe(true)
    expect(trace.checkpoints[2]!.unresolved).toBe(false)
  })

  it('native 版でも同じシナリオを再生できる', async () => {
    const trace = await runScenario({
      url: `${server.url}/native`,
      scenario: scenario([{ index: 0, action: 'click', selector: '[data-testid="toggle-badge"]' }]),
      config,
      probePath,
    })

    expect(trace.checkpoints[1]!.styles['[data-testid="badge"]']?.display).toBe('none')
  })
})
