import { describe, expect, it } from 'vitest'
import { renderHtml, summarize } from '../src/reporter/html.js'
import type { Diff, Finding } from '../src/types.js'

function finding(over: Partial<Finding> = {}): Finding {
  return {
    kind: 'style',
    target: '#badge',
    prop: 'display',
    detail: 'display が異なる',
    baselineValue: 'inline-flex',
    candidateValue: 'block',
    checkpointIndex: 1,
    severity: 'critical',
    ...over,
  }
}

function diff(over: Partial<Diff> = {}): Diff {
  return {
    scenarioId: 's1',
    baseline: 'http://localhost/jquery',
    candidate: 'http://localhost/native',
    structural: [],
    findings: [finding()],
    ...over,
  }
}

describe('summarize', () => {
  it('セベリティごとに件数を数える', () => {
    const counts = summarize(
      diff({
        findings: [
          finding({ severity: 'critical' }),
          finding({ severity: 'warning' }),
          finding({ severity: 'warning' }),
        ],
      }),
    )
    expect(counts).toEqual({ critical: 1, warning: 2, info: 0, structural: 0 })
  })

  it('structural issue も数える', () => {
    const counts = summarize(
      diff({
        findings: [],
        structural: [
          { kind: 'unresolved-selector', checkpointIndex: 2, detail: '#gone が見つからない' },
        ],
      }),
    )
    expect(counts).toEqual({ critical: 0, warning: 0, info: 0, structural: 1 })
  })
})

describe('renderHtml', () => {
  it('自己完結した HTML を出す(外部参照を含まない)', () => {
    const html = renderHtml(diff())
    expect(html).toContain('<!doctype html>')
    expect(html).not.toMatch(/<script[^>]+src=/)
    expect(html).not.toMatch(/<link[^>]+href="http/)
  })

  it('セレクタ・プロパティ・両側の値を出す', () => {
    const html = renderHtml(diff())
    expect(html).toContain('#badge')
    expect(html).toContain('display')
    expect(html).toContain('inline-flex')
    expect(html).toContain('block')
  })

  it('critical を warning より先に並べる', () => {
    const html = renderHtml(
      diff({
        findings: [
          finding({ severity: 'warning', target: '#later' }),
          finding({ severity: 'critical', target: '#earlier' }),
        ],
      }),
    )
    expect(html.indexOf('#earlier')).toBeLessThan(html.indexOf('#later'))
  })

  it('HTML を含む値をエスケープする', () => {
    const html = renderHtml(
      diff({ findings: [finding({ candidateValue: '<img src=x onerror=alert(1)>' })] }),
    )
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })

  it('structural issue を findings より前に出す', () => {
    const html = renderHtml(
      diff({
        structural: [
          { kind: 'checkpoint-count-mismatch', checkpointIndex: null, detail: '3 対 2' },
        ],
      }),
    )
    expect(html).toContain('checkpoint-count-mismatch')
    expect(html.indexOf('checkpoint-count-mismatch')).toBeLessThan(html.indexOf('#badge'))
  })

  it('差分ゼロなら差分なしと明示する', () => {
    const html = renderHtml(diff({ findings: [] }))
    expect(html).toContain('差分なし')
  })
})
