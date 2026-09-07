import type { Checkpoint, MutationEntry, Trace } from '../types.js'

/** CSS セレクタと属性値の両方を安全に切れる区切り文字 */
const TOKEN_SPLIT = /([\s>+~#.[\]="'():,])/

/** 自動採番パターンに合致するトークンを <gen> に置き換える。 */
export function collapseGenerated(value: string, patterns: RegExp[]): string {
  return value
    .split(TOKEN_SPLIT)
    .map((t) => (t && patterns.some((p) => p.test(t)) ? '<gen>' : t))
    .join('')
}

/** class 属性値をトークンに分解しソートして再結合する。 */
export function normalizeClassValue(value: string): string {
  return value.trim().split(/\s+/).filter(Boolean).sort().join(' ')
}

function mutationKey(m: MutationEntry): string {
  return `${m.type}|${m.target}|${m.attributeName ?? ''}`
}

/**
 * 同一チェックポイント区間内で (type, target, attributeName) が同じ mutation を
 * 1 件にまとめる。oldValue は最初の値、newValue は最後の値を採る。
 * アニメーション由来の中間状態が差分を埋め尽くすのを防ぐのが目的。
 */
export function collapseMutations(mutations: MutationEntry[]): MutationEntry[] {
  const map = new Map<string, MutationEntry>()
  const order: string[] = []

  for (const m of mutations) {
    const key = mutationKey(m)
    const prev = map.get(key)
    if (!prev) {
      map.set(key, {
        ...m,
        added: m.added ? [...m.added] : undefined,
        removed: m.removed ? [...m.removed] : undefined,
      })
      order.push(key)
      continue
    }
    prev.newValue = m.newValue
    if (m.type === 'childList') {
      prev.added = [...(prev.added ?? []), ...(m.added ?? [])]
      prev.removed = [...(prev.removed ?? []), ...(m.removed ?? [])]
    }
  }

  return order
    .map((k) => cancelChildList(map.get(k)!))
    .filter(
      (m) => m.type !== 'childList' || (m.added?.length ?? 0) > 0 || (m.removed?.length ?? 0) > 0,
    )
}

function tally(values: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1)
  return counts
}

/** counts にある分だけ打ち消しながら、残ったものを元の順で返す。 */
function keepUncancelled(values: string[], counts: Map<string, number>): string[] {
  const kept: string[] = []
  for (const v of values) {
    const n = counts.get(v) ?? 0
    if (n > 0) {
      counts.set(v, n - 1)
      continue
    }
    kept.push(v)
  }
  return kept
}

/**
 * 同じ記述子が added と removed の両方にあれば打ち消す。
 * 出入りの差し引きがゼロなら DOM には何も残らない。
 * jQuery が機能検出のために足して外す要素や、script を作り直す実装差がここで消える。
 */
export function cancelChildList(m: MutationEntry): MutationEntry {
  if (m.type !== 'childList') return m
  const added = m.added ?? []
  const removed = m.removed ?? []
  return {
    ...m,
    added: keepUncancelled(added, tally(removed)),
    removed: keepUncancelled(removed, tally(added)),
  }
}

/** 実行順の揺らぎを消すため決定的に並べ替える。 */
export function sortMutations(mutations: MutationEntry[]): MutationEntry[] {
  return [...mutations].sort((a, b) => mutationKey(a).localeCompare(mutationKey(b)))
}

function normalizeMutation(m: MutationEntry, patterns: RegExp[]): MutationEntry {
  const isClass = m.attributeName === 'class'
  const norm = (v: string | null | undefined): string | null | undefined => {
    if (v == null) return v
    const collapsed = collapseGenerated(v, patterns)
    return isClass ? normalizeClassValue(collapsed) : collapsed
  }
  return {
    ...m,
    target: collapseGenerated(m.target, patterns),
    oldValue: norm(m.oldValue),
    newValue: norm(m.newValue),
    added: m.added?.map((a) => collapseGenerated(a, patterns)),
    removed: m.removed?.map((r) => collapseGenerated(r, patterns)),
  }
}

export function normalizeCheckpoint(cp: Checkpoint, patterns: RegExp[]): Checkpoint {
  const mutations = sortMutations(
    collapseMutations(cp.mutations.map((m) => normalizeMutation(m, patterns))),
  )

  const styles: Record<string, Record<string, string>> = {}
  for (const [selector, props] of Object.entries(cp.styles)) {
    styles[collapseGenerated(selector, patterns)] = props
  }

  // network と event は実行順そのものが意味を持つので順序を崩さない
  return {
    ...cp,
    mutations,
    styles,
    events: cp.events.map((e) => ({
      ...e,
      target: collapseGenerated(e.target, patterns),
      currentTarget: collapseGenerated(e.currentTarget, patterns),
    })),
  }
}

export function normalizeTrace(trace: Trace, patterns: RegExp[]): Trace {
  return {
    ...trace,
    checkpoints: trace.checkpoints.map((cp) => normalizeCheckpoint(cp, patterns)),
  }
}
