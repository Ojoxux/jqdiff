import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { JqdiffConfig } from './types.js'

export const DEFAULT_GENERATED_ID_PATTERNS: RegExp[] = [
  /^jQuery\d+$/,
  /^ui-id-\d+$/,
  /^select2-/,
  /^:r[a-z0-9]+:$/,
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/,
]

export const DEFAULT_STYLE_PROPS: string[] = [
  'display', 'visibility', 'opacity', 'position', 'top', 'right', 'bottom', 'left',
  'width', 'height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'color', 'background-color', 'font-size', 'font-weight', 'line-height', 'text-align',
  'transform', 'z-index', 'overflow-x', 'overflow-y',
  'flex-direction', 'justify-content', 'align-items', 'gap',
  'pointer-events', 'cursor', 'white-space',
]

export const DEFAULT_CONFIG: JqdiffConfig = {
  generatedIdPatterns: DEFAULT_GENERATED_ID_PATTERNS,
  styleProps: DEFAULT_STYLE_PROPS,
  ignore: { selectors: [], styleProps: [], headers: [], urls: [] },
  severityOverrides: {},
  waitAfterStep: 0,
}

export type UserConfig = {
  generatedIdPatterns?: RegExp[]
  styleProps?: string[]
  ignore?: Partial<JqdiffConfig['ignore']>
  severityOverrides?: Record<string, JqdiffConfig['severityOverrides'][string]>
  waitAfterStep?: number
}

export function resolveConfig(user: UserConfig = {}): JqdiffConfig {
  return {
    // 上書きではなく追加。1 パターン足しただけで jQuery の採番検出が消えると事故る。
    generatedIdPatterns: [
      ...DEFAULT_GENERATED_ID_PATTERNS,
      ...(user.generatedIdPatterns ?? []),
    ],
    styleProps: user.styleProps ?? DEFAULT_STYLE_PROPS,
    ignore: {
      selectors: user.ignore?.selectors ?? [],
      styleProps: user.ignore?.styleProps ?? [],
      headers: user.ignore?.headers ?? [],
      urls: user.ignore?.urls ?? [],
    },
    severityOverrides: user.severityOverrides ?? {},
    waitAfterStep: user.waitAfterStep ?? 0,
  }
}

export const CONFIG_FILENAME = 'jqdiff.config.ts'

/**
 * プロジェクトルートの jqdiff.config.ts を読む。無ければデフォルト。
 *
 * 「ファイルが無い」だけがデフォルトへの正当な入口で、それ以外の失敗は必ず投げる。
 * 握り潰すと、ノイズを削るために ignore を書いている最中に無言でデフォルトへ戻り、
 * 設定が効いていないのか本当にノイズが消えたのかを区別できなくなる。
 */
export async function loadConfig(cwd: string): Promise<JqdiffConfig> {
  const path = join(cwd, CONFIG_FILENAME)

  try {
    await stat(path)
  } catch {
    return resolveConfig({})
  }

  let mod: { default?: unknown }
  try {
    // 絶対パスをそのまま import 指定子にすると環境差が出るため file:// URL にする
    mod = (await import(/* @vite-ignore */ pathToFileURL(path).href)) as { default?: unknown }
  } catch (error) {
    throw new Error(`${path} を読み込めませんでした`, { cause: error })
  }

  const user = mod.default
  if (user === undefined) {
    throw new Error(`${path} に default export がありません`)
  }
  if (typeof user !== 'object' || user === null) {
    throw new Error(`${path} の default export はオブジェクトである必要があります`)
  }

  return resolveConfig(user as UserConfig)
}
