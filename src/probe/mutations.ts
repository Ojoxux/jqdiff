import type { MutationEntry } from '../types.js'
import { buildSelector, describeNode } from './selector.js'
import type { PendingMutation, ProbeState } from './state.js'

function isScript(node: Node): boolean {
  return node.nodeType === 1 && (node as Element).tagName === 'SCRIPT'
}

/**
 * 記録しても意味のないノード。
 * script は移行の前後で必ず形が変わる(jQuery の .html() は type を書き換えて head で評価し、
 * innerHTML は実行しないので作り直す)一方、実行結果そのものは他の記録に必ず現れる。
 * 空白だけのテキストノードは見た目にも意味にも出ない。
 */
function isNoise(node: Node): boolean {
  if (isScript(node)) return true
  return node.nodeType === 3 && (node.textContent ?? '').trim() === ''
}

function toEntry(record: MutationRecord, patterns: RegExp[]): PendingMutation | null {
  const el =
    record.target.nodeType === 1 ? (record.target as Element) : record.target.parentElement
  if (!el || isScript(el)) return null

  const target = buildSelector(el, patterns)

  if (record.type === 'attributes') {
    const name = record.attributeName ?? ''
    const entry: MutationEntry = {
      type: 'attributes',
      target,
      attributeName: name,
      oldValue: record.oldValue,
      // flush 時点の現在値を読む。同一属性の連続変化は collapseMutations が
      // 「最初の oldValue と最後の newValue」に畳むので結果は一致する。
      newValue: el.getAttribute(name),
    }
    return { entry, element: el }
  }

  if (record.type === 'characterData') {
    const entry: MutationEntry = {
      type: 'characterData',
      target,
      oldValue: record.oldValue,
      newValue: record.target.textContent,
    }
    return { entry, element: el }
  }

  const added = Array.from(record.addedNodes)
    .filter((n) => !isNoise(n))
    .map((n) => describeNode(n, patterns))
  const removed = Array.from(record.removedNodes)
    .filter((n) => !isNoise(n))
    .map((n) => describeNode(n, patterns))
  if (added.length === 0 && removed.length === 0) return null

  return { entry: { type: 'childList', target, added, removed }, element: el }
}

/** MutationObserver を設置する。戻り値を呼ぶと記録を停止する。 */
export function installMutationRecorder(state: ProbeState): () => void {
  const patterns = state.config.generatedIdPatterns

  const drain = (records: MutationRecord[]): void => {
    for (const record of records) {
      const pending = toEntry(record, patterns)
      if (!pending) continue
      state.styleTargets.add(pending.element)
      if (pending.element.parentElement) state.styleTargets.add(pending.element.parentElement)
      state.pendingMutations.push(pending)
    }
  }

  const observer = new MutationObserver(drain)
  // documentElement ではなく document を観る。probe は addInitScript で
  // ページのスクリプトより先に走るため、この時点で documentElement がまだ無い。
  observer.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
    attributeOldValue: true,
    characterDataOldValue: true,
  })

  const flush = (): void => drain(observer.takeRecords())
  state.flushers.push(flush)

  return () => {
    observer.disconnect()
    const i = state.flushers.indexOf(flush)
    if (i >= 0) state.flushers.splice(i, 1)
  }
}
