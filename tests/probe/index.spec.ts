// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { installProbe } from '../../src/probe/index.js'

function boot() {
  ;(globalThis as Record<string, unknown>).__jqdiffConfig = {
    generatedIdPatternSources: ['^jQuery\\d+$'],
    styleProps: ['display', 'width'],
    scenarioId: 's1',
  }
  return installProbe()
}

describe('installProbe', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="box"></div>'
    delete (globalThis as Record<string, unknown>).__jqdiff
  })

  it('window.__jqdiff を生やす', () => {
    boot()
    expect((globalThis as Record<string, unknown>).__jqdiff).toBeDefined()
  })

  it('checkpoint が pending を回収して空にする', () => {
    const api = boot()
    document.querySelector('#box')!.setAttribute('class', 'on')
    api.checkpoint(null)

    const trace = api.dump()
    expect(trace.checkpoints).toHaveLength(1)
    expect(trace.checkpoints[0]!.mutations).toHaveLength(1)

    api.checkpoint(null)
    expect(api.dump().checkpoints[1]!.mutations).toHaveLength(0)
  })

  it('変更のあった要素の computed style を採る', () => {
    const api = boot()
    document.querySelector('#box')!.setAttribute('style', 'display: none')
    api.checkpoint(null)

    const styles = api.dump().checkpoints[0]!.styles
    expect(styles['#box']).toBeDefined()
    expect(Object.keys(styles['#box']!).sort()).toEqual(['display', 'width'])
    expect(styles['#box']!.display).toBe('none')
  })

  it('step と unresolved をチェックポイントに保存する', () => {
    const api = boot()
    const step = { index: 0, action: 'click' as const, selector: '#gone' }
    api.checkpoint(step, true)

    const cp = api.dump().checkpoints[0]!
    expect(cp.step).toEqual(step)
    expect(cp.unresolved).toBe(true)
  })

  it('設定の正規表現ソースを RegExp として解釈する', () => {
    const api = boot()
    document.body.innerHTML = '<div id="jQuery999"></div>'
    document.querySelector('#jQuery999')!.setAttribute('class', 'on')
    api.checkpoint(null)

    const mutations = api.dump().checkpoints[0]!.mutations
    const attr = mutations.find((m) => m.type === 'attributes')!
    expect(attr.target).not.toContain('jQuery999')
  })

  it('dump は meta にシナリオ ID と URL を含める', () => {
    const api = boot()
    const meta = api.dump().meta
    expect(meta.scenarioId).toBe('s1')
    expect(meta.url).toBe(location.href)
  })
})
