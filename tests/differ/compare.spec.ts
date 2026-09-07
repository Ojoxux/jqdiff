import { describe, expect, it } from 'vitest'
import {
  compareEvents,
  compareMutations,
  compareNetwork,
  compareStyles,
  normalizeUrl,
} from '../../src/differ/compare.js'
import type { EventEntry, MutationEntry, NetworkEntry } from '../../src/types.js'

const IGNORE = { selectors: [], styleProps: [], headers: [], urls: [] }

function net(over: Partial<NetworkEntry> = {}): NetworkEntry {
  return {
    transport: 'xhr',
    method: 'POST',
    url: '/api/save',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-requested-with': 'XMLHttpRequest',
    },
    body: 'title=hello',
    status: 200,
    ok: true,
    ...over,
  }
}

describe('normalizeUrl', () => {
  it('クエリをキー順に並べ替える', () => {
    expect(normalizeUrl('/a?b=2&a=1')).toBe('/a?a=1&b=2')
  })
  it('オリジンを落としてパス以降で比較できるようにする', () => {
    expect(normalizeUrl('http://localhost:3000/a?x=1')).toBe('/a?x=1')
  })
})

describe('compareNetwork', () => {
  it('同一なら差分なし', () => {
    expect(compareNetwork([net()], [net()], IGNORE)).toEqual([])
  })

  it('ヘッダの欠落を検出する', () => {
    const candidate = net({ headers: { 'content-type': 'application/json' } })
    const diffs = compareNetwork([net()], [candidate], IGNORE)
    const headers = diffs.filter((d) => d.prop?.startsWith('header:'))
    expect(headers.map((d) => d.prop)).toContain('header:x-requested-with')
    expect(headers.map((d) => d.prop)).toContain('header:content-type')
  })

  it('form-urlencoded と JSON の body 差を検出する', () => {
    const candidate = net({
      headers: { 'content-type': 'application/json' },
      body: '{"title":"hello"}',
    })
    const diffs = compareNetwork([net()], [candidate], IGNORE)
    expect(diffs.some((d) => d.prop === 'body')).toBe(true)
  })

  it('form-urlencoded のキー順違いは差分にしない', () => {
    const a = net({ body: 'a=1&b=2' })
    const b = net({ body: 'b=2&a=1' })
    expect(compareNetwork([a], [b], IGNORE).filter((d) => d.prop === 'body')).toEqual([])
  })

  it('JSON のキー順違いは差分にしない', () => {
    const a = net({ headers: { 'content-type': 'application/json' }, body: '{"a":1,"b":2}' })
    const b = net({ headers: { 'content-type': 'application/json' }, body: '{"b":2,"a":1}' })
    expect(compareNetwork([a], [b], IGNORE).filter((d) => d.prop === 'body')).toEqual([])
  })

  it('リクエスト件数の差を検出する', () => {
    const diffs = compareNetwork([net()], [], IGNORE)
    expect(diffs.some((d) => d.prop === 'missing')).toBe(true)
  })

  it('accept の未指定はブラウザ既定値として扱う', () => {
    // XHR は setRequestHeader を記録できるが fetch は Request のヘッダしか見えない。
    // どちらも実際に送られるのは */* なので差分にしてはならない。
    const xhr = net({ headers: { accept: '*/*' } })
    const fetched = net({ transport: 'fetch', headers: {} })
    const diffs = compareNetwork([xhr], [fetched], IGNORE)
    expect(diffs.map((d) => d.prop)).not.toContain('header:accept')
  })

  it('明示的な accept の喪失は検出する', () => {
    const xhr = net({ headers: { accept: 'application/json' } })
    const fetched = net({ transport: 'fetch', headers: {} })
    const diffs = compareNetwork([xhr], [fetched], IGNORE)
    expect(diffs.map((d) => d.prop)).toContain('header:accept')
  })

  it('ignore.urls に合致する通信は無視する', () => {
    const analytics = net({ url: '/collect?id=1' })
    expect(compareNetwork([analytics], [], { ...IGNORE, urls: [/\/collect/] })).toEqual([])
  })
})

function ev(over: Partial<EventEntry> = {}): EventEntry {
  return {
    type: 'click',
    target: '#inner-link',
    currentTarget: '#inner-link',
    phase: 'target',
    defaultPreventedBefore: false,
    defaultPreventedAfter: true,
    propagationStoppedAfter: true,
    ...over,
  }
}

describe('compareEvents', () => {
  it('同一なら差分なし', () => {
    expect(compareEvents([ev()], [ev()])).toEqual([])
  })

  it('ページ寿命のイベントは比較しない', () => {
    // jQuery は自前の ready のために DOMContentLoaded を張る。
    // 誰がハンドラを持つかは実装都合で、初期化の結果は DOM 変更に出る。
    const ready = ev({ type: 'DOMContentLoaded', target: '#document', currentTarget: '#document' })
    expect(compareEvents([ready], [])).toEqual([])
  })

  it('stopPropagation の欠落を検出する', () => {
    const diffs = compareEvents([ev()], [ev({ propagationStoppedAfter: false })])
    expect(diffs.some((d) => d.prop === 'propagationStopped')).toBe(true)
  })

  it('preventDefault の欠落を検出する', () => {
    const diffs = compareEvents([ev()], [ev({ defaultPreventedAfter: false })])
    expect(diffs.some((d) => d.prop === 'defaultPrevented')).toBe(true)
  })

  it('伝播が親まで届いてしまった差を path として検出する', () => {
    const stopped = [ev()]
    const leaked = [
      ev({ propagationStoppedAfter: false }),
      ev({ currentTarget: '#outer', phase: 'bubble', propagationStoppedAfter: false }),
    ]
    const diffs = compareEvents(stopped, leaked)
    expect(diffs.some((d) => d.prop === 'propagationPath')).toBe(true)
  })

  it('同じ要素にハンドラが何個登録されていても差分にしない', () => {
    // jQuery の委譲は 1 個のネイティブリスナーで捌くが native 版は個別登録になる。
    // 正しい移行でこれが差分になっては使い物にならない。
    const one = [
      ev({
        currentTarget: '#list',
        target: '#item',
        propagationStoppedAfter: false,
        defaultPreventedAfter: false,
      }),
    ]
    const two = [
      ev({
        currentTarget: '#list',
        target: '#item',
        propagationStoppedAfter: false,
        defaultPreventedAfter: false,
      }),
      ev({
        currentTarget: '#list',
        target: '#item',
        propagationStoppedAfter: false,
        defaultPreventedAfter: false,
      }),
    ]
    expect(compareEvents(one, two)).toEqual([])
  })

  it('ディスパッチ順の入れ替わりを order として検出する', () => {
    const click = ev({ type: 'click', target: '#a', currentTarget: '#a' })
    const change = ev({ type: 'change', target: '#b', currentTarget: '#b' })
    const diffs = compareEvents([click, change], [change, click])
    expect(diffs.some((d) => d.prop === 'order')).toBe(true)
  })

  it('ディスパッチの欠落を検出する', () => {
    expect(compareEvents([ev()], []).some((d) => d.prop === 'missing')).toBe(true)
  })
})

describe('compareStyles', () => {
  it('display の差を検出する', () => {
    const diffs = compareStyles(
      { '#badge': { display: 'inline-flex' } },
      { '#badge': { display: 'block' } },
      IGNORE,
    )
    expect(diffs).toHaveLength(1)
    expect(diffs[0]!.prop).toBe('display')
    expect(diffs[0]!.baselineValue).toBe('inline-flex')
    expect(diffs[0]!.candidateValue).toBe('block')
  })

  it('片側にしか無いセレクタは無視する(採取範囲の違いを差分にしない)', () => {
    expect(compareStyles({ '#a': { display: 'block' } }, {}, IGNORE)).toEqual([])
  })

  it('ignore.styleProps を尊重する', () => {
    const diffs = compareStyles(
      { '#a': { width: '0px' } },
      { '#a': { width: '10px' } },
      { ...IGNORE, styleProps: ['width'] },
    )
    expect(diffs).toEqual([])
  })
})

describe('compareMutations', () => {
  const m = (over: Partial<MutationEntry> = {}): MutationEntry => ({
    type: 'attributes',
    target: '#a',
    attributeName: 'class',
    oldValue: '',
    newValue: 'active',
    ...over,
  })

  it('同一なら差分なし', () => {
    expect(compareMutations([m()], [m()], IGNORE)).toEqual([])
  })

  it('baseline にしか無い mutation を検出する', () => {
    const diffs = compareMutations([m()], [], IGNORE)
    expect(diffs).toHaveLength(1)
    expect(diffs[0]!.candidateValue).toBeNull()
  })

  it('candidate にしか無い mutation を検出する', () => {
    const diffs = compareMutations([], [m()], IGNORE)
    expect(diffs).toHaveLength(1)
    expect(diffs[0]!.baselineValue).toBeNull()
  })

  it('ignore.selectors に合致する対象は無視する', () => {
    expect(compareMutations([m()], [], { ...IGNORE, selectors: ['#a'] })).toEqual([])
  })

  it('属性の mutation は属性名を prop にする(class/style だけを降格対象にするため)', () => {
    const diffs = compareMutations([m({ attributeName: 'data-script-ran' })], [], IGNORE)
    expect(diffs[0]!.prop).toBe('data-script-ran')
  })
})
