import { describe, expect, it } from 'vitest'
import { diffTraces } from '../../src/differ/index.js'
import { resolveConfig } from '../../src/config.js'
import type { Checkpoint, Trace } from '../../src/types.js'

const config = resolveConfig({})

function cp(over: Partial<Checkpoint> = {}): Checkpoint {
  return {
    index: 0,
    step: null,
    unresolved: false,
    mutations: [],
    network: [],
    events: [],
    styles: {},
    ...over,
  }
}

function trace(url: string, checkpoints: Checkpoint[]): Trace {
  return { meta: { url, scenarioId: 's1', startedAt: '2026-01-01T00:00:00Z' }, checkpoints }
}

describe('diffTraces', () => {
  it('同一トレースなら findings は空', () => {
    const t = trace('http://a', [cp()])
    expect(diffTraces(t, trace('http://b', [cp()]), config).findings).toEqual([])
  })

  it('display の差を critical として報告する', () => {
    const a = trace('http://a', [cp({ styles: { '#badge': { display: 'inline-flex' } } })])
    const b = trace('http://b', [cp({ styles: { '#badge': { display: 'block' } } })])
    const d = diffTraces(a, b, config)
    expect(d.findings).toHaveLength(1)
    expect(d.findings[0]!.severity).toBe('critical')
    expect(d.findings[0]!.checkpointIndex).toBe(0)
  })

  it('自動採番 id の違いは差分にならない', () => {
    const a = trace('http://a', [
      cp({
        mutations: [
          { type: 'attributes', target: '#jQuery111', attributeName: 'class', oldValue: '', newValue: 'on' },
        ],
      }),
    ])
    const b = trace('http://b', [
      cp({
        mutations: [
          { type: 'attributes', target: '#jQuery999', attributeName: 'class', oldValue: '', newValue: 'on' },
        ],
      }),
    ])
    expect(diffTraces(a, b, config).findings).toEqual([])
  })

  it('computed style が一致するなら inline style と class の差は info になる', () => {
    const styles = { '#box': { display: 'none' } }
    const a = trace('http://a', [
      cp({
        styles,
        mutations: [
          { type: 'attributes', target: '#box', attributeName: 'style', oldValue: '', newValue: 'display: none' },
        ],
      }),
    ])
    const b = trace('http://b', [
      cp({
        styles,
        mutations: [
          { type: 'attributes', target: '#box', attributeName: 'class', oldValue: '', newValue: 'hidden' },
        ],
      }),
    ])
    const d = diffTraces(a, b, config)
    expect(d.findings.length).toBeGreaterThan(0)
    expect(d.findings.every((f) => f.severity === 'info')).toBe(true)
  })

  it('チェックポイント数の不一致を構造的問題として報告する', () => {
    const d = diffTraces(
      trace('http://a', [cp(), cp({ index: 1 })]),
      trace('http://b', [cp()]),
      config,
    )
    expect(d.structural.some((s) => s.kind === 'checkpoint-count-mismatch')).toBe(true)
  })

  it('unresolved なチェックポイントは比較対象から外し構造的問題として報告する', () => {
    const a = trace('http://a', [cp({ styles: { '#x': { display: 'block' } } })])
    const b = trace('http://b', [cp({ unresolved: true, styles: { '#x': { display: 'none' } } })])
    const d = diffTraces(a, b, config)
    expect(d.findings).toEqual([])
    expect(d.structural.some((s) => s.kind === 'unresolved-selector')).toBe(true)
  })

  it('findings は critical / warning / info の順に並ぶ', () => {
    const a = trace('http://a', [
      cp({ styles: { '#x': { display: 'block', cursor: 'auto', width: '10px' } } }),
    ])
    const b = trace('http://b', [
      cp({ styles: { '#x': { display: 'none', cursor: 'pointer', width: '20px' } } }),
    ])
    const d = diffTraces(a, b, config)
    expect(d.findings.map((f) => f.severity)).toEqual(['critical', 'warning', 'info'])
  })
})
