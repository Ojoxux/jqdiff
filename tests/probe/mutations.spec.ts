// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { createState } from '../../src/probe/state.js'
import { installMutationRecorder } from '../../src/probe/mutations.js'

function setup() {
  const state = createState(
    { generatedIdPatterns: [/^jQuery\d+$/], styleProps: ['display'] },
    { url: 'http://x/', scenarioId: 's', startedAt: '2026-01-01T00:00:00Z' },
  )
  const dispose = installMutationRecorder(state)
  return { state, dispose, flush: () => state.flushers.forEach((f) => f()) }
}

describe('installMutationRecorder', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  it('属性の変更を記録する', () => {
    document.body.innerHTML = '<div id="box"></div>'
    const { state, flush } = setup()
    document.querySelector('#box')!.setAttribute('class', 'active')
    flush()
    expect(state.pendingMutations).toHaveLength(1)
    expect(state.pendingMutations[0]?.entry).toMatchObject({
      type: 'attributes',
      target: '#box',
      attributeName: 'class',
      oldValue: null,
      newValue: 'active',
    })
  })

  it('子要素の追加と削除を記録する', () => {
    document.body.innerHTML = '<ul id="list"><li class="old"></li></ul>'
    const { state, flush } = setup()
    const list = document.querySelector('#list')!
    list.querySelector('.old')!.remove()
    const li = document.createElement('li')
    li.className = 'new'
    list.appendChild(li)
    flush()
    const childList = state.pendingMutations
      .map((m) => m.entry)
      .filter((m) => m.type === 'childList')
    expect(childList.flatMap((m) => m.removed ?? [])).toContain('li.old')
    expect(childList.flatMap((m) => m.added ?? [])).toContain('li.new')
  })

  it('テキストの変更は親要素を対象として記録する', () => {
    document.body.innerHTML = '<p id="msg">before</p>'
    const { state, flush } = setup()
    document.querySelector('#msg')!.firstChild!.textContent = 'after'
    flush()
    const cd = state.pendingMutations.map((m) => m.entry).find((m) => m.type === 'characterData')
    expect(cd).toMatchObject({ target: '#msg', oldValue: 'before', newValue: 'after' })
  })

  it('変更のあった要素とその親をスタイル採取対象に積む', () => {
    document.body.innerHTML = '<div id="outer"><span id="inner"></span></div>'
    const { state, flush } = setup()
    document.querySelector('#inner')!.setAttribute('data-x', '1')
    flush()
    const targets = Array.from(state.styleTargets)
    expect(targets).toContain(document.querySelector('#inner'))
    expect(targets).toContain(document.querySelector('#outer'))
  })

  it('script の出入りと空白テキストは記録しない', () => {
    document.body.innerHTML = '<div id="host"></div>'
    const { state, flush } = setup()
    const host = document.querySelector('#host')!
    host.innerHTML = '\n  <script>void 0;<\/script>\n  '
    flush()
    const added = state.pendingMutations.map((m) => m.entry).flatMap((m) => m.added ?? [])
    expect(added).not.toContain('script')
    expect(added).not.toContain('#text:""')
  })

  it('script 自身への属性変更は記録しない', () => {
    document.body.innerHTML = '<script id="s"><\/script>'
    const { state, flush } = setup()
    document.querySelector('#s')!.setAttribute('type', 'false/')
    flush()
    expect(state.pendingMutations).toHaveLength(0)
  })

  it('dispose 後は記録しない', () => {
    document.body.innerHTML = '<div id="box"></div>'
    const { state, dispose, flush } = setup()
    dispose()
    document.querySelector('#box')!.setAttribute('class', 'active')
    flush()
    expect(state.pendingMutations).toHaveLength(0)
  })
})
