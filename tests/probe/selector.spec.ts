// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { buildSelector } from '../../src/probe/selector.js'

const PATTERNS = [/^jQuery\d+$/, /^ui-id-\d+$/]

function setBody(html: string) {
  document.body.innerHTML = html
}

function sel(el: Element) {
  return buildSelector(el, PATTERNS)
}

describe('buildSelector', () => {
  beforeEach(() => setBody(''))

  it('data-testid を最優先する', () => {
    setBody('<div id="real" data-testid="box"></div>')
    expect(sel(document.querySelector('#real')!)).toBe('[data-testid="box"]')
  })

  it('data-testid が無ければ id を使う', () => {
    setBody('<div id="real"></div>')
    expect(sel(document.querySelector('#real')!)).toBe('#real')
  })

  it('自動採番 id は使わず構造パスにフォールバックする', () => {
    setBody('<div id="jQuery12345"></div>')
    const s = sel(document.querySelector('div')!)
    expect(s).not.toContain('jQuery12345')
    expect(s).toContain('body')
  })

  it('name 属性を持つフォーム要素は name で表す', () => {
    setBody('<form><input name="title"></form>')
    expect(sel(document.querySelector('input')!)).toBe('input[name="title"]')
  })

  it('構造パスから自動採番 class を除外する', () => {
    setBody('<div class="ui-id-9 card"></div>')
    const s = sel(document.querySelector('div')!)
    expect(s).toContain('.card')
    expect(s).not.toContain('ui-id-9')
  })

  it('兄弟要素を nth-child で区別する', () => {
    setBody('<ul><li class="row"></li><li class="row"></li></ul>')
    const items = document.querySelectorAll('li')
    const a = sel(items[0]!)
    const b = sel(items[1]!)
    expect(a).not.toBe(b)
    expect(document.querySelectorAll(a).length).toBe(1)
    expect(document.querySelector(a)).toBe(items[0])
    expect(document.querySelector(b)).toBe(items[1])
  })

  it('生成したセレクタは常に元の要素を一意に解決する', () => {
    setBody('<div class="a"><span class="b">x</span><span class="b">y</span></div>')
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const s = sel(el)
      expect(document.querySelectorAll(s).length, s).toBe(1)
      expect(document.querySelector(s), s).toBe(el)
    }
  })
})
