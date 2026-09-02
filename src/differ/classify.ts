import type { RawDiff, Severity } from '../types.js'

/** 見えるか見えないかを決めるプロパティ。ここの差は必ず視覚デグレになる。 */
export const CRITICAL_STYLE_PROPS = ['display', 'visibility', 'opacity', 'pointer-events']

export const WARNING_STYLE_PROPS = [
  'width', 'height', 'position', 'top', 'right', 'bottom', 'left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'overflow-x', 'overflow-y', 'z-index',
  'color', 'background-color', 'font-size', 'font-weight', 'line-height',
  'text-align', 'transform',
]

export type ClassifyContext = {
  /** この差分の対象セレクタについて、baseline と candidate の computed style が全一致するか */
  computedStyleEqual: boolean
}

export function classify(
  diff: RawDiff,
  ctx: ClassifyContext,
  overrides: Record<string, Severity>,
): Severity {
  if (diff.prop && overrides[diff.prop]) return overrides[diff.prop]!

  switch (diff.kind) {
    case 'network':
      return 'critical'

    case 'event':
      if (
        diff.prop === 'defaultPrevented' ||
        diff.prop === 'propagationStopped' ||
        diff.prop === 'propagationPath' ||
        diff.prop === 'missing'
      ) {
        return 'critical'
      }
      return 'warning'

    case 'style':
      if (diff.prop && CRITICAL_STYLE_PROPS.includes(diff.prop)) return 'critical'
      if (diff.prop && WARNING_STYLE_PROPS.includes(diff.prop)) return 'warning'
      return 'info'

    case 'mutation':
      // 要素の増減と表示テキストはユーザーに見えるものそのものなので降格対象外。
      if (diff.prop === 'childList' || diff.prop === 'characterData') return 'warning'
      // class / style の付け替えだけが「実装手段の違い」になりうる。
      // inline style をやめて class 切り替えにする書き換えを吸収するのが目的。
      if (diff.prop === 'class' || diff.prop === 'style') {
        return ctx.computedStyleEqual ? 'info' : 'warning'
      }
      // data-* / aria-* / disabled などは見た目に出なくても挙動を変えるので降格しない。
      return 'warning'
  }
}
