// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createState } from '../../src/probe/state.js'
import { installEventRecorder, markInternal } from '../../src/probe/events.js'
import type { ProbeState } from '../../src/probe/state.js'

let state: ProbeState
let dispose: () => void

beforeEach(() => {
  document.body.innerHTML = '<div id="outer"><a id="inner" href="#">x</a></div>'
  // jsdom のセレクタエンジンは最初の querySelector で window に capture の
  // click リスナーを足す。install より後に登録されるとラップ対象に混ざるので、
  // 先に一度呼んで登録を済ませておく。実ブラウザには存在しない事情。
  document.querySelector('#outer')
  state = createState(
    { generatedIdPatterns: [], styleProps: [] },
    { url: 'http://x/', scenarioId: 's', startedAt: '2026-01-01T00:00:00Z' },
  )
  dispose = installEventRecorder(state)
})

afterEach(() => dispose())

describe('installEventRecorder', () => {
  it('ハンドラ呼び出しを currentTarget つきで記録する', () => {
    const inner = document.querySelector('#inner')!
    inner.addEventListener('click', () => {})
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(state.pendingEvents).toHaveLength(1)
    expect(state.pendingEvents[0]).toMatchObject({
      type: 'click',
      target: '#inner',
      currentTarget: '#inner',
      phase: 'target',
    })
  })

  it('preventDefault の有無を記録する', () => {
    const inner = document.querySelector('#inner')!
    inner.addEventListener('click', (e) => e.preventDefault())
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(state.pendingEvents[0]).toMatchObject({
      defaultPreventedBefore: false,
      defaultPreventedAfter: true,
      propagationStoppedAfter: false,
    })
  })

  it('stopPropagation の有無を記録する', () => {
    const inner = document.querySelector('#inner')!
    inner.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
    })
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(state.pendingEvents[0]!.propagationStoppedAfter).toBe(true)
  })

  it('stopPropagation を実際に伝播へ効かせる(ラップが挙動を変えない)', () => {
    const outer = document.querySelector('#outer')!
    const inner = document.querySelector('#inner')!
    let outerCalled = false
    outer.addEventListener('click', () => {
      outerCalled = true
    })
    inner.addEventListener('click', (e) => e.stopPropagation())
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))

    expect(outerCalled).toBe(false)
  })

  it('登録順どおりに記録する', () => {
    const outer = document.querySelector('#outer')!
    outer.addEventListener('click', () => {}, false)
    const inner = document.querySelector('#inner')!
    inner.addEventListener('click', () => {})
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(state.pendingEvents.map((e) => e.currentTarget)).toEqual(['#inner', '#outer'])
    expect(state.pendingEvents.map((e) => e.phase)).toEqual(['target', 'bubble'])
  })

  it('removeEventListener が元の関数参照で機能する', () => {
    const inner = document.querySelector('#inner')!
    const handler = () => {}
    inner.addEventListener('click', handler)
    inner.removeEventListener('click', handler)
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(state.pendingEvents).toHaveLength(0)
  })

  it('内部用と印をつけたリスナーは記録しない', () => {
    const inner = document.querySelector('#inner')!
    inner.addEventListener('click', markInternal(() => {}))
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(state.pendingEvents).toHaveLength(0)
  })

  it('dispose 後は記録しない', () => {
    dispose()
    const inner = document.querySelector('#inner')!
    inner.addEventListener('click', () => {})
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true }))

    expect(state.pendingEvents).toHaveLength(0)
  })
})
