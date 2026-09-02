import { describe, expect, it } from 'vitest'
import { classify } from '../../src/differ/classify.js'
import type { RawDiff } from '../../src/types.js'

const raw = (over: Partial<RawDiff>): RawDiff => ({
  kind: 'style',
  target: '#a',
  detail: '',
  baselineValue: 'x',
  candidateValue: 'y',
  ...over,
})

const ctx = (computedStyleEqual: boolean) => ({ computedStyleEqual })

describe('classify', () => {
  it('network の差分は常に critical', () => {
    expect(classify(raw({ kind: 'network', prop: 'header:x-requested-with' }), ctx(false), {}))
      .toBe('critical')
  })

  it('preventDefault / stopPropagation の差は critical', () => {
    expect(classify(raw({ kind: 'event', prop: 'defaultPrevented' }), ctx(false), {})).toBe('critical')
    expect(classify(raw({ kind: 'event', prop: 'propagationStopped' }), ctx(false), {})).toBe('critical')
  })

  it('伝播経路の差は critical', () => {
    expect(classify(raw({ kind: 'event', prop: 'propagationPath' }), ctx(false), {})).toBe('critical')
  })

  it('イベントの発火順の差は warning', () => {
    expect(classify(raw({ kind: 'event', prop: 'order' }), ctx(false), {})).toBe('warning')
  })

  it('可視性に関わる computed style の差は critical', () => {
    for (const prop of ['display', 'visibility', 'opacity', 'pointer-events']) {
      expect(classify(raw({ kind: 'style', prop }), ctx(false), {}), prop).toBe('critical')
    }
  })

  it('レイアウト系と外観系の computed style の差は warning', () => {
    for (const prop of ['width', 'position', 'color', 'font-size', 'transform']) {
      expect(classify(raw({ kind: 'style', prop }), ctx(false), {}), prop).toBe('warning')
    }
  })

  it('分類対象外の computed style は info', () => {
    expect(classify(raw({ kind: 'style', prop: 'cursor' }), ctx(false), {})).toBe('info')
  })

  it('要素の増減と表示テキストの差は warning', () => {
    expect(classify(raw({ kind: 'mutation', prop: 'childList' }), ctx(false), {})).toBe('warning')
    expect(classify(raw({ kind: 'mutation', prop: 'characterData' }), ctx(false), {})).toBe('warning')
  })

  it('computed style が一致するなら class / style の mutation 差は info に降格する', () => {
    expect(classify(raw({ kind: 'mutation', prop: 'class' }), ctx(true), {})).toBe('info')
    expect(classify(raw({ kind: 'mutation', prop: 'style' }), ctx(true), {})).toBe('info')
  })

  it('computed style が一致しても childList / characterData は降格しない', () => {
    // 表示テキストと要素の増減はユーザーに見えるものそのものなので降格対象外
    expect(classify(raw({ kind: 'mutation', prop: 'childList' }), ctx(true), {})).toBe('warning')
    expect(classify(raw({ kind: 'mutation', prop: 'characterData' }), ctx(true), {})).toBe('warning')
  })

  it('computed style が一致しても class / style 以外の属性は降格しない', () => {
    // 見た目に出ない挙動デグレ(script が動かず data 属性が付かない等)を info に埋めないため
    expect(classify(raw({ kind: 'mutation', prop: 'data-script-ran' }), ctx(true), {})).toBe('warning')
    expect(classify(raw({ kind: 'mutation', prop: 'disabled' }), ctx(true), {})).toBe('warning')
  })

  it('computed style が違う class / style の mutation 差は warning', () => {
    expect(classify(raw({ kind: 'mutation', prop: 'class' }), ctx(false), {})).toBe('warning')
  })

  it('severityOverrides が他のすべてのルールに優先する', () => {
    expect(classify(raw({ kind: 'style', prop: 'cursor' }), ctx(false), { cursor: 'critical' }))
      .toBe('critical')
    expect(classify(raw({ kind: 'network', prop: 'status' }), ctx(false), { status: 'info' }))
      .toBe('info')
  })
})
