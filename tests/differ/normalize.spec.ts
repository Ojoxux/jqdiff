import { describe, expect, it } from 'vitest'
import {
  collapseGenerated,
  collapseMutations,
  normalizeClassValue,
  sortMutations,
} from '../../src/differ/normalize.js'
import type { MutationEntry } from '../../src/types.js'

const PATTERNS = [/^jQuery\d+$/, /^ui-id-\d+$/]

describe('collapseGenerated', () => {
  it('セレクタ中の自動採番 id を畳む', () => {
    expect(collapseGenerated('#jQuery12345 > div:nth-child(2)', PATTERNS))
      .toBe('#<gen> > div:nth-child(2)')
  })

  it('属性値中の自動採番トークンだけを畳む', () => {
    expect(collapseGenerated('ui-id-7 card', PATTERNS)).toBe('<gen> card')
  })

  it('該当しない値はそのまま返す', () => {
    expect(collapseGenerated('#save-form', PATTERNS)).toBe('#save-form')
  })
})

describe('normalizeClassValue', () => {
  it('トークンをソートして順序差を消す', () => {
    expect(normalizeClassValue('b  a')).toBe('a b')
    expect(normalizeClassValue('a b')).toBe('a b')
  })

  it('空文字を安全に扱う', () => {
    expect(normalizeClassValue('   ')).toBe('')
  })
})

function attr(target: string, name: string, oldV: string, newV: string): MutationEntry {
  return { type: 'attributes', target, attributeName: name, oldValue: oldV, newValue: newV }
}

describe('collapseMutations', () => {
  it('同一 target・同一属性の連続変化を 1 件に畳み、最初と最後の値を残す', () => {
    const out = collapseMutations([
      attr('#bar', 'style', 'width: 0px', 'width: 10px'),
      attr('#bar', 'style', 'width: 10px', 'width: 20px'),
      attr('#bar', 'style', 'width: 20px', 'width: 300px'),
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.oldValue).toBe('width: 0px')
    expect(out[0]!.newValue).toBe('width: 300px')
  })

  it('別の属性は畳まない', () => {
    const out = collapseMutations([
      attr('#bar', 'style', 'a', 'b'),
      attr('#bar', 'class', 'x', 'y'),
    ])
    expect(out).toHaveLength(2)
  })

  it('childList の added / removed は連結する', () => {
    const out = collapseMutations([
      { type: 'childList', target: '#list', added: ['li'], removed: [] },
      { type: 'childList', target: '#list', added: ['li.new'], removed: ['li.old'] },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]!.added).toEqual(['li', 'li.new'])
    expect(out[0]!.removed).toEqual(['li.old'])
  })
})

describe('sortMutations', () => {
  it('target・type・属性名で決定的に並べ替える', () => {
    const a = attr('#b', 'class', '', '')
    const b = attr('#a', 'style', '', '')
    expect(sortMutations([a, b]).map((m) => m.target)).toEqual(['#a', '#b'])
    expect(sortMutations([b, a]).map((m) => m.target)).toEqual(['#a', '#b'])
  })
})
