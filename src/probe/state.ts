import type { Checkpoint, EventEntry, MutationEntry, NetworkEntry, Trace } from '../types.js'

export type ProbeConfig = {
  generatedIdPatterns: RegExp[]
  styleProps: string[]
}

export type ProbeState = {
  config: ProbeConfig
  meta: Trace['meta']
  pendingMutations: MutationEntry[]
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
