import { buildSelector } from './selector.js'

/**
 * 対象要素の computed style を採る。
 * 全 DOM を走査するとコストが重すぎるため、対象は mutation 起点で絞られている前提。
 */
export function collectStyles(
  targets: Iterable<Element>,
  props: string[],
  patterns: RegExp[],
): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {}

  for (const el of targets) {
    // 既に外れた要素は computed style を持たないので飛ばす
    if (!el.isConnected) continue

    const selector = buildSelector(el, patterns)
    const computed = getComputedStyle(el)
    const values: Record<string, string> = {}
    for (const prop of props) {
      values[prop] = computed.getPropertyValue(prop)
    }
    out[selector] = values
  }

  return out
}
