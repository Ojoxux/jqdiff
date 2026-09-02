import type { EventEntry, JqdiffConfig, MutationEntry, NetworkEntry, RawDiff } from '../types.js'

type Ignore = JqdiffConfig['ignore']

export const DEFAULT_HEADER_ALLOWLIST = [
  'content-type',
  'x-requested-with',
  'accept',
  'authorization',
  'x-csrf-token',
]

/** オリジンを落とし、クエリをキー順に並べ替える。 */
export function normalizeUrl(url: string): string {
  let path = url
  let query = ''
  const qIndex = url.indexOf('?')
  if (qIndex >= 0) {
    path = url.slice(0, qIndex)
    query = url.slice(qIndex + 1)
  }
  try {
    const parsed = new URL(path, 'http://x.invalid')
    path = parsed.pathname
  } catch {
    // 相対パスのまま扱う
  }
  if (!query) return path
  const params = Array.from(new URLSearchParams(query).entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  )
  return `${path}?${params.map(([k, v]) => `${k}=${v}`).join('&')}`
}

function lowerKeys(h: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(h)) out[k.toLowerCase()] = v
  return out
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep)
  if (v && typeof v === 'object') {
    const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    )
    return Object.fromEntries(entries.map(([k, val]) => [k, sortDeep(val)]))
  }
  return v
}

/** Content-Type に応じて body をキー順が影響しない正規形にする。 */
export function normalizeBody(body: string | null, contentType: string | undefined): string {
  if (body == null) return ''
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('application/json')) {
    try {
      return JSON.stringify(sortDeep(JSON.parse(body)))
    } catch {
      return body
    }
  }
  if (ct.includes('application/x-www-form-urlencoded')) {
    const params = Array.from(new URLSearchParams(body).entries()).sort(([a], [b]) =>
      a.localeCompare(b),
    )
    return params.map(([k, v]) => `${k}=${v}`).join('&')
  }
  return body
}

function urlIgnored(url: string, patterns: (string | RegExp)[]): boolean {
  return patterns.some((p) => (typeof p === 'string' ? url.includes(p) : p.test(url)))
}

export function compareNetwork(
  baseline: NetworkEntry[],
  candidate: NetworkEntry[],
  ignore: Ignore,
): RawDiff[] {
  const a = baseline.filter((n) => !urlIgnored(n.url, ignore.urls))
  const b = candidate.filter((n) => !urlIgnored(n.url, ignore.urls))
  const diffs: RawDiff[] = []
  const allowed = DEFAULT_HEADER_ALLOWLIST.filter((h) => !ignore.headers.includes(h))

  const max = Math.max(a.length, b.length)
  for (let i = 0; i < max; i++) {
    const x = a[i]
    const y = b[i]

    if (!x || !y) {
      const present = (x ?? y)!
      diffs.push({
        kind: 'network',
        target: normalizeUrl(present.url),
        prop: 'missing',
        detail: x ? 'baseline にのみ存在するリクエスト' : 'candidate にのみ存在するリクエスト',
        baselineValue: x ? `${x.method} ${normalizeUrl(x.url)}` : null,
        candidateValue: y ? `${y.method} ${normalizeUrl(y.url)}` : null,
      })
      continue
    }

    const target = normalizeUrl(x.url)
    const push = (prop: string, detail: string, bv: string | null, cv: string | null) => {
      if (bv !== cv) {
        diffs.push({ kind: 'network', target, prop, detail, baselineValue: bv, candidateValue: cv })
      }
    }

    push('method', 'HTTP メソッドが異なる', x.method, y.method)
    push('url', 'リクエスト URL が異なる', normalizeUrl(x.url), normalizeUrl(y.url))
    push('status', 'レスポンスステータスが異なる', String(x.status), String(y.status))

    const hx = lowerKeys(x.headers)
    const hy = lowerKeys(y.headers)
    for (const h of allowed) {
      push(`header:${h}`, `リクエストヘッダ ${h} が異なる`, hx[h] ?? null, hy[h] ?? null)
    }

    push(
      'body',
      'リクエストボディが異なる',
      normalizeBody(x.body, hx['content-type']),
      normalizeBody(y.body, hy['content-type']),
    )
  }

  return diffs
}

/** 1 回の dispatchEvent に対応する、意味単位のイベント処理結果 */
export type DispatchGroup = {
  type: string
  target: string
  /** 実際に到達した currentTarget の列(重複除去)。伝播がどこまで進んだかを表す */
  path: string[]
  defaultPrevented: boolean
  propagationStopped: boolean
}

/**
 * ハンドラ呼び出しの列を 1 回のディスパッチ単位にまとめる。
 * jQuery の委譲は 1 個のネイティブリスナーで複数ハンドラを捌くのに対し
 * native 版では個別に登録するのが自然で、正しい移行でも呼び出し件数が変わる。
 * 件数ではなく「イベントが意味的にどう処理されたか」を比較するための前処理。
 */
export function groupDispatches(events: EventEntry[]): DispatchGroup[] {
  const groups: DispatchGroup[] = []

  for (const e of events) {
    const last = groups[groups.length - 1]
    if (last && last.type === e.type && last.target === e.target) {
      if (!last.path.includes(e.currentTarget)) last.path.push(e.currentTarget)
      last.defaultPrevented = last.defaultPrevented || e.defaultPreventedAfter
      last.propagationStopped = last.propagationStopped || e.propagationStoppedAfter
      continue
    }
    groups.push({
      type: e.type,
      target: e.target,
      path: [e.currentTarget],
      defaultPrevented: e.defaultPreventedAfter,
      propagationStopped: e.propagationStoppedAfter,
    })
  }

  return groups
}

export function compareEvents(baseline: EventEntry[], candidate: EventEntry[]): RawDiff[] {
  const a = groupDispatches(baseline)
  const b = groupDispatches(candidate)
  const diffs: RawDiff[] = []
  const max = Math.max(a.length, b.length)

  for (let i = 0; i < max; i++) {
    const x = a[i]
    const y = b[i]

    if (!x || !y) {
      const present = (x ?? y)!
      const label = (g: DispatchGroup) => `${g.type}@${g.target}`
      diffs.push({
        kind: 'event',
        target: present.target,
        prop: 'missing',
        detail: x ? 'baseline にのみ存在するイベント処理' : 'candidate にのみ存在するイベント処理',
        baselineValue: x ? label(x) : null,
        candidateValue: y ? label(y) : null,
      })
      continue
    }

    if (x.type !== y.type || x.target !== y.target) {
      diffs.push({
        kind: 'event',
        target: x.target,
        prop: 'order',
        detail: 'イベントの発火順または発火対象が異なる',
        baselineValue: `${x.type}@${x.target}`,
        candidateValue: `${y.type}@${y.target}`,
      })
      continue
    }

    if (x.defaultPrevented !== y.defaultPrevented) {
      diffs.push({
        kind: 'event',
        target: x.target,
        prop: 'defaultPrevented',
        detail: `${x.type} の preventDefault の有無が異なる`,
        baselineValue: String(x.defaultPrevented),
        candidateValue: String(y.defaultPrevented),
      })
    }

    if (x.propagationStopped !== y.propagationStopped) {
      diffs.push({
        kind: 'event',
        target: x.target,
        prop: 'propagationStopped',
        detail: `${x.type} の stopPropagation の有無が異なる`,
        baselineValue: String(x.propagationStopped),
        candidateValue: String(y.propagationStopped),
      })
    }

    const pathA = x.path.join(' > ')
    const pathB = y.path.join(' > ')
    if (pathA !== pathB) {
      diffs.push({
        kind: 'event',
        target: x.target,
        prop: 'propagationPath',
        detail: `${x.type} が到達した要素が異なる`,
        baselineValue: pathA,
        candidateValue: pathB,
      })
    }
  }

  return diffs
}

type Styles = Record<string, Record<string, string>>

export function compareStyles(baseline: Styles, candidate: Styles, ignore: Ignore): RawDiff[] {
  const diffs: RawDiff[] = []

  for (const [selector, baseProps] of Object.entries(baseline)) {
    if (ignore.selectors.includes(selector)) continue
    const candProps = candidate[selector]
    // 採取範囲は mutation 起点なので、片側にしか無いのは「そもそも触られていない」を意味する。
    // これを差分にすると採取範囲の違いがノイズになるため無視する。
    if (!candProps) continue

    for (const [prop, baseValue] of Object.entries(baseProps)) {
      if (ignore.styleProps.includes(prop)) continue
      const candValue = candProps[prop]
      if (candValue === undefined || candValue === baseValue) continue
      diffs.push({
        kind: 'style',
        target: selector,
        prop,
        detail: `computed style の ${prop} が異なる`,
        baselineValue: baseValue,
        candidateValue: candValue,
      })
    }
  }

  return diffs
}

function mutationSignature(m: MutationEntry): string {
  return JSON.stringify([
    m.type,
    m.target,
    m.attributeName ?? '',
    m.oldValue ?? null,
    m.newValue ?? null,
    m.added ?? [],
    m.removed ?? [],
  ])
}

/**
 * 属性変更は属性名そのものを prop にする。
 * class / style の付け替えだけを降格対象にしたいので、分類側で名前が見える必要がある。
 * data-* や disabled まで一緒くたに降格すると、見た目に出ない挙動デグレを取り逃がす。
 */
function diffProp(m: MutationEntry): string {
  return m.type === 'attributes' ? (m.attributeName ?? 'attributes') : m.type
}

export function compareMutations(
  baseline: MutationEntry[],
  candidate: MutationEntry[],
  ignore: Ignore,
): RawDiff[] {
  const keep = (m: MutationEntry) => !ignore.selectors.includes(m.target)
  const a = baseline.filter(keep)
  const b = candidate.filter(keep)

  const bSigs = new Map<string, MutationEntry>()
  for (const m of b) bSigs.set(mutationSignature(m), m)
  const aSigs = new Map<string, MutationEntry>()
  for (const m of a) aSigs.set(mutationSignature(m), m)

  const diffs: RawDiff[] = []

  for (const [sig, m] of aSigs) {
    if (bSigs.has(sig)) continue
    diffs.push({
      kind: 'mutation',
      target: m.target,
      prop: diffProp(m),
      detail: `baseline にのみ存在する DOM 変更 (${m.attributeName ?? m.type})`,
      baselineValue: m.newValue ?? sig,
      candidateValue: null,
    })
  }

  for (const [sig, m] of bSigs) {
    if (aSigs.has(sig)) continue
    diffs.push({
      kind: 'mutation',
      target: m.target,
      prop: diffProp(m),
      detail: `candidate にのみ存在する DOM 変更 (${m.attributeName ?? m.type})`,
      baselineValue: null,
      candidateValue: m.newValue ?? sig,
    })
  }

  return diffs
}
