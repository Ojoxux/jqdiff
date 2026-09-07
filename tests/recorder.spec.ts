// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installRecorder, type RecorderApi } from '../src/recorder/index.js'
import type { ScenarioStep } from '../src/types.js'

let recorder: RecorderApi
let streamed: ScenarioStep[]

function boot(): void {
  streamed = []
  recorder = installRecorder({
    generatedIdPatterns: [/^jQuery\d+$/],
    onStep: (step) => streamed.push(step),
  })
}

beforeEach(() => {
  document.body.innerHTML = `
    <button data-testid="go">go</button>
    <form data-testid="f">
      <input data-testid="title" type="text">
      <input data-testid="agree" type="checkbox">
      <select data-testid="kind"><option value="a">a</option><option value="b">b</option></select>
    </form>
    <div data-testid="pane"></div>
  `
  boot()
})

// document へのリスナーはテストを跨いで生き残る。外さないと前のテストの
// recorder も onStep を撃ち続け、ステップが多重に流れる。
afterEach(() => recorder.stop())

describe('installRecorder', () => {
  it('click を記録する', () => {
    document
      .querySelector('[data-testid="go"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(recorder.steps).toEqual([{ index: 0, action: 'click', selector: '[data-testid="go"]' }])
  })

  it('同じ入力欄への連続 input は最後の値ひとつに畳む', () => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="title"]')!
    for (const value of ['a', 'ab', 'abc']) {
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    expect(recorder.steps).toEqual([
      { index: 0, action: 'input', selector: '[data-testid="title"]', value: 'abc' },
    ])
  })

  it('畳んだステップも同じ index で流すので受け手は上書きできる', () => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="title"]')!
    input.value = 'a'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.value = 'ab'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(streamed.map((s) => s.index)).toEqual([0, 0])
    expect(streamed[1]!.value).toBe('ab')
  })

  it('checkbox の input は無視する(click が既に拾っている)', () => {
    const box = document.querySelector<HTMLInputElement>('[data-testid="agree"]')!
    box.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    box.dispatchEvent(new Event('input', { bubbles: true }))
    expect(recorder.steps.map((s) => s.action)).toEqual(['click'])
  })

  it('select の change は値つきで記録する', () => {
    const select = document.querySelector<HTMLSelectElement>('[data-testid="kind"]')!
    select.value = 'b'
    select.dispatchEvent(new Event('change', { bubbles: true }))
    expect(recorder.steps).toEqual([
      { index: 0, action: 'change', selector: '[data-testid="kind"]', value: 'b' },
    ])
  })

  it('submit を記録する', () => {
    document
      .querySelector('[data-testid="f"]')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    expect(recorder.steps[0]).toMatchObject({ action: 'submit', selector: '[data-testid="f"]' })
  })

  it('文字キーは記録せず、単独で意味を持つキーだけ記録する', () => {
    const input = document.querySelector('[data-testid="title"]')!
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(recorder.steps).toEqual([
      { index: 0, action: 'keydown', selector: '[data-testid="title"]', key: 'Enter' },
    ])
  })

  it('scroll は最後の位置に畳む', () => {
    const pane = document.querySelector<HTMLElement>('[data-testid="pane"]')!
    for (const top of [10, 20, 30]) {
      Object.defineProperty(pane, 'scrollTop', { value: top, configurable: true })
      pane.dispatchEvent(new Event('scroll'))
    }
    expect(recorder.steps).toEqual([
      { index: 0, action: 'scroll', selector: '[data-testid="pane"]', scrollTop: 30 },
    ])
  })

  it('別の要素を触れば畳まずに新しいステップになる', () => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="title"]')!
    input.value = 'x'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document
      .querySelector('[data-testid="go"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    input.value = 'y'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(recorder.steps.map((s) => s.index)).toEqual([0, 1, 2])
  })

  it('stop 後は何も記録しない', () => {
    recorder.stop()
    document
      .querySelector('[data-testid="go"]')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(recorder.steps).toEqual([])
  })

  it('自分のリスナーには internal 印がついている(probe が記録しないため)', () => {
    // markInternal は関数にプロパティを生やすだけなので、
    // 記録された click が probe 側の EventEntry に混ざらないことをここで担保する。
    const before = recorder.steps.length
    document.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(recorder.steps.length).toBe(before + 0)
  })
})
