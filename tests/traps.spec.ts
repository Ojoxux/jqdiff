import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveConfig } from '../src/config.js'
import { diffTraces } from '../src/differ/index.js'
import { runScenario } from '../src/runner/index.js'
import type { Diff, Finding, Scenario } from '../src/types.js'
// @ts-expect-error 型定義のない fixture サーバを直接読む
import { startFixtureServer } from '../fixture/server.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const probePath = join(root, 'dist', 'probe', 'index.global.js')
const config = resolveConfig({})

/** fixture の全機能を一巡する。罠はどれも「操作したのに結果が違う」形で現れる。 */
const SCENARIO: Scenario = {
  id: 'traps',
  recordedAt: '2026-01-01T00:00:00.000Z',
  startUrl: '/',
  viewport: { width: 1280, height: 800 },
  steps: [
    { index: 0, action: 'click', selector: '[data-testid="toggle-badge"]' },
    { index: 1, action: 'click', selector: '[data-testid="toggle-badge"]' },
    { index: 2, action: 'click', selector: '[data-testid="inner-link"]' },
    { index: 3, action: 'input', selector: '[data-testid="title-input"]', value: 'hello' },
    { index: 4, action: 'click', selector: '[data-testid="save-btn"]' },
    { index: 5, action: 'click', selector: '[data-testid="fail-btn"]' },
    { index: 6, action: 'click', selector: '[data-testid="widen-btn"]' },
    { index: 7, action: 'click', selector: '[data-testid="missing-btn"]' },
    { index: 8, action: 'click', selector: '[data-testid="item-1"]' },
    { index: 9, action: 'click', selector: '[data-testid="inject-btn"]' },
  ],
}

let server: { url: string; close: () => Promise<void> }
/** ベースラインは 1 回だけ録れば足りる。罠ごとに再生し直すのは candidate 側だけ。 */
let baselineTrace: Awaited<ReturnType<typeof runScenario>>

beforeAll(async () => {
  server = await startFixtureServer(0)
  baselineTrace = await runScenario({
    url: `${server.url}/jquery`,
    scenario: SCENARIO,
    config,
    probePath,
  })
}, 120_000)

afterAll(() => server.close())

async function diffWithTraps(traps: string): Promise<Diff> {
  const candidateTrace = await runScenario({
    url: `${server.url}/native?traps=${traps}`,
    scenario: SCENARIO,
    config,
    probePath,
  })
  return diffTraces(baselineTrace, candidateTrace, config)
}

function find(diff: Diff, predicate: (f: Finding) => boolean): Finding[] {
  return diff.findings.filter(predicate)
}

/** デバッグしやすいよう、期待が外れたときに実際の Finding を出す */
function explain(diff: Diff): string {
  return JSON.stringify(
    diff.findings.map((f) => [f.severity, f.kind, f.target, f.prop, f.detail]),
    null,
    2,
  )
}

describe('罠カタログ', () => {
  it('罠 1: show() の display 復元漏れを critical な style 差として検出する', async () => {
    const diff = await diffWithTraps('1')
    const hits = find(
      diff,
      (f) => f.kind === 'style' && f.prop === 'display' && f.target.includes('badge'),
    )
    expect(hits.length, explain(diff)).toBeGreaterThan(0)
    expect(hits[0]!.severity).toBe('critical')
    expect(hits[0]!.baselineValue).toBe('inline-flex')
    expect(hits[0]!.candidateValue).toBe('block')
  }, 120_000)

  it('罠 2: return false のバブリング停止漏れを critical な event 差として検出する', async () => {
    const diff = await diffWithTraps('2')
    const hits = find(
      diff,
      (f) => f.kind === 'event' && (f.prop === 'propagationStopped' || f.prop === 'propagationPath'),
    )
    expect(hits.length, explain(diff)).toBeGreaterThan(0)
    expect(hits.every((f) => f.severity === 'critical')).toBe(true)

    // 親ハンドラが動いてしまう副作用も別途出るはず
    expect(find(diff, (f) => f.target.includes('bubble-log')).length).toBeGreaterThan(0)
  }, 120_000)

  it('罠 3: $.ajax のデフォルトヘッダと body 形式の喪失を critical な network 差として検出する', async () => {
    const diff = await diffWithTraps('3')
    const hits = find(diff, (f) => f.kind === 'network' && f.target.includes('/api/save'))
    expect(hits.length, explain(diff)).toBeGreaterThan(0)
    expect(hits.every((f) => f.severity === 'critical')).toBe(true)
    expect(hits.some((f) => f.prop?.includes('content-type'))).toBe(true)
    expect(hits.some((f) => f.prop?.includes('x-requested-with') || f.prop === 'body')).toBe(true)
  }, 120_000)

  it('罠 4: fetch が 500 で reject しないためエラー UI が出ないことを検出する', async () => {
    const diff = await diffWithTraps('4')
    const hits = find(diff, (f) => f.target.includes('error-box'))
    expect(hits.length, explain(diff)).toBeGreaterThan(0)
    // 表示テキストが出ない = childList / characterData の差なので warning
    expect(hits.some((f) => f.severity === 'warning')).toBe(true)
  }, 120_000)

  it('罠 5: px なしの style.width が効かないことを mutation 差として検出する', async () => {
    const diff = await diffWithTraps('5')
    // 単位無しの代入は何も起こさないので、candidate 側には mutation が 1 件も無い。
    // computed style は mutation のあった要素だけを採るため style 差としては見えず、
    // 「baseline にしか無い style 属性の変更」として現れる。
    const hits = find(diff, (f) => f.target.includes('bar'))
    expect(hits.length, explain(diff)).toBeGreaterThan(0)
    expect(hits[0]!.kind).toBe('mutation')
    expect(hits[0]!.prop).toBe('style')
    // 見た目が変わる差なので info に降格してはならない
    expect(hits[0]!.severity).toBe('warning')
  }, 120_000)

  it('罠 6: 0 件セレクタの TypeError で以降の DOM 更新が欠落することを検出する', async () => {
    const diff = await diffWithTraps('6')
    const hits = find(diff, (f) => f.target.includes('after-missing'))
    expect(hits.length, explain(diff)).toBeGreaterThan(0)
    // baseline にだけ 'updated' が入るので、candidate 側が null になる
    expect(hits.some((f) => f.candidateValue === null)).toBe(true)
  }, 120_000)

  it('罠 7: 委譲ハンドラの発火順の入れ替わりを表示テキストの差として検出する', async () => {
    const diff = await diffWithTraps('7')
    const hits = find(diff, (f) => f.target.includes('order-log'))
    expect(hits.length, explain(diff)).toBeGreaterThan(0)
  }, 120_000)

  it('罠 7: ディスパッチ単位で比較しているので event 側には差分が出ない', async () => {
    // 登録リスナー数ではなく伝播経路を比べているので、
    // 「委譲 1 個 対 直接 2 個」という実装差自体は差分にならない
    const diff = await diffWithTraps('7')
    expect(find(diff, (f) => f.kind === 'event').length, explain(diff)).toBe(0)
  }, 120_000)

  it('罠 8: innerHTML が script を実行しないことを mutation 差として検出する', async () => {
    const diff = await diffWithTraps('8')
    const hits = find(diff, (f) => f.kind === 'mutation' && f.prop === 'data-script-ran')
    expect(hits.length, explain(diff)).toBeGreaterThan(0)
    // 見た目には出ないが挙動が変わる差なので info に降格してはならない
    expect(hits.every((f) => f.severity === 'warning')).toBe(true)
  }, 120_000)

  it('罠を全部有効にすると critical が複数出る', async () => {
    const diff = await diffWithTraps('1,2,3,4,5,6,7,8')
    expect(diff.findings.filter((f) => f.severity === 'critical').length).toBeGreaterThan(1)
  }, 180_000)
})

describe('false positive がないこと', () => {
  it('罠を全部無効にすると Finding が 0 件になる', async () => {
    const diff = await diffWithTraps('')
    expect(diff.findings, explain(diff)).toEqual([])
    expect(diff.structural).toEqual([])
  }, 120_000)
})
