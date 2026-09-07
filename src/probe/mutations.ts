import type { MutationEntry } from '../types.js'
import { buildSelector, describeNode } from './selector.js'
import type { ProbeState } from './state.js'

function toEntry(record: MutationRecord, patterns: RegExp[]): MutationEntry {
  const el = record.target.nodeType === 1 ? (record.target as Element) : record.target.parentElement
  const target = el ? buildSelector(el, patterns) : describeNode(record.target, patterns)

  if (record.type === 'attributes') {
    const name = record.attributeName ?? ''
    return {
      type: 'attributes',
      target,
      attributeName: name,
      oldValue: record.oldValue,
      // flush 時点の現在値を読む。同一属性の連続変化は collapseMutations が
      // 「最初の oldValue と最後の newValue」に畳むので結果は一致する。
      newValue: el ? el.getAttribute(name) : null,
    }
  }

  if (record.type === 'characterData') {
    return {
      type: 'characterData',
      target,
      oldValue: record.oldValue,
      newValue: record.target.textContent,
    }
  }

  return {
    type: 'childList',
    target,
    added: Array.from(record.addedNodes).map((n) => describeNode(n, patterns)),
    removed: Array.from(record.removedNodes).map((n) => describeNode(n, patterns)),
  }
}

/** MutationObserver を設置する。戻り値を呼ぶと記録を停止する。 */
export function installMutationRecorder(state: ProbeState): () => void {
  const patterns = state.config.generatedIdPatterns

  const drain = (records: MutationRecord[]): void => {
    for (const record of records) {
      const el =
        record.target.nodeType === 1 ? (record.target as Element) : record.target.parentElement
      if (el) {
        state.styleTargets.add(el)
        if (el.parentElement) state.styleTargets.add(el.parentElement)
      }
      state.pendingMutations.push(toEntry(record, patterns))
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
