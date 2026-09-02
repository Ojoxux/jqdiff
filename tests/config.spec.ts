import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, resolveConfig } from '../src/config.js'

describe('resolveConfig', () => {
  it('未指定の項目はデフォルトで埋める', () => {
    const c = resolveConfig({ waitAfterStep: 500 })
    expect(c.waitAfterStep).toBe(500)
    expect(c.styleProps).toEqual(DEFAULT_CONFIG.styleProps)
  })

  it('generatedIdPatterns は上書きではなく追加する', () => {
    const extra = /^tmp-\d+$/
    const c = resolveConfig({ generatedIdPatterns: [extra] })
    expect(c.generatedIdPatterns).toContain(extra)
    expect(c.generatedIdPatterns.length).toBe(DEFAULT_CONFIG.generatedIdPatterns.length + 1)
  })

  it('ignore は部分指定でも他のキーが消えない', () => {
    const c = resolveConfig({ ignore: { selectors: ['#ads'] } })
    expect(c.ignore.selectors).toEqual(['#ads'])
    expect(c.ignore.headers).toEqual([])
  })
})
