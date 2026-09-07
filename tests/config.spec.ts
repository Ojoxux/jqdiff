import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, loadConfig, resolveConfig } from '../src/config.js'

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

/**
 * 設定を読めなかったことは黙って握り潰してはならない。
 * ノイズを削るために ignore を書いている最中に無言でデフォルトへ戻されると、
 * 「設定が効いていない」のか「本当にノイズが消えた」のかを区別できなくなる。
 */
describe('loadConfig', () => {
  const scratch = (): Promise<string> => mkdtemp(join(tmpdir(), 'jqdiff-config-'))

  it('設定ファイルが無ければデフォルトを返す', async () => {
    const c = await loadConfig(await scratch())
    expect(c).toEqual(resolveConfig({}))
  })

  it('設定ファイルの内容を反映する', async () => {
    const dir = await scratch()
    await writeFile(
      join(dir, 'jqdiff.config.ts'),
      'export default { waitAfterStep: 250, ignore: { urls: ["/analytics"] } }\n',
    )
    const c = await loadConfig(dir)
    expect(c.waitAfterStep).toBe(250)
    expect(c.ignore.urls).toEqual(['/analytics'])
  })

  it('設定ファイルが壊れていれば、デフォルトに戻さず失敗する', async () => {
    const dir = await scratch()
    await writeFile(join(dir, 'jqdiff.config.ts'), 'export default { waitAfterStep: (((\n')
    await expect(loadConfig(dir)).rejects.toThrow(/jqdiff\.config\.ts/)
  })

  it('default export が無ければ失敗する', async () => {
    const dir = await scratch()
    await writeFile(join(dir, 'jqdiff.config.ts'), 'export const waitAfterStep = 250\n')
    await expect(loadConfig(dir)).rejects.toThrow(/default export/)
  })
})
