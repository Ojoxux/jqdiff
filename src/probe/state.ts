import type { Checkpoint, EventEntry, MutationEntry, NetworkEntry, Trace } from '../types.js'

export type ProbeConfig = {
  generatedIdPatterns: RegExp[]
  styleProps: string[]
}

/**
 * 記録した DOM 変更と、その変更が起きた要素。
 * チェックポイント時に「まだ文書に繋がっているか」を見るために要素を保持する。
 * ライブラリが機能検出のために作って捨てる要素の変更を落とすのが目的。
 */
export type PendingMutation = {
  entry: MutationEntry
  element: Element
}

export type ProbeState = {
  config: ProbeConfig
  meta: Trace['meta']
  pendingMutations: PendingMutation[]
  pendingNetwork: NetworkEntry[]
  pendingEvents: EventEntry[]
  /** チェックポイント時に computed style を採る対象 */
  styleTargets: Set<Element>
  checkpoints: Checkpoint[]
  /** 非同期に溜まる記録を同期的に吐き出させる関数群 */
  flushers: Array<() => void>
}

export function createState(config: ProbeConfig, meta: Trace['meta']): ProbeState {
  return {
    config,
    meta,
    pendingMutations: [],
    pendingNetwork: [],
    pendingEvents: [],
    styleTargets: new Set(),
    checkpoints: [],
    flushers: [],
  }
}
