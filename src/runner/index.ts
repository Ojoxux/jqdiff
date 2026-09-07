import { readFile } from 'node:fs/promises'
import { chromium, type Page } from 'playwright'
import type { JqdiffConfig, Scenario, ScenarioStep, Trace } from '../types.js'
import { determinismScript } from './determinism.js'

export class ProbeInjectionError extends Error {}

export type RunOptions = {
  /** 再生先の完全な URL。クエリを含めて呼び出し側が組み立てる */
  url: string
  scenario: Scenario
  config: JqdiffConfig
  /** ビルド済み probe(IIFE)のパス */
  probePath: string
  headless?: boolean
  /** 1 ステップあたりの操作タイムアウト(ms) */
  stepTimeout?: number
}

type ProbeWindow = {
  __jqdiff?: {
    checkpoint(step: ScenarioStep | null, unresolved?: boolean): void
    dump(): Trace
  }
}

async function settle(page: Page, extraWait: number): Promise<void> {
  try {
    await page.waitForLoadState('networkidle', { timeout: 5000 })
  } catch {
    // networkidle に到達しないページ(ポーリング等)でも先に進む
  }
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
  if (extraWait > 0) await page.waitForTimeout(extraWait)
}

/** ステップを実行する。セレクタが解決できなければ false を返す。 */
async function performStep(page: Page, step: ScenarioStep, timeout: number): Promise<boolean> {
  const locator = page.locator(step.selector).first()
  try {
    switch (step.action) {
      case 'click':
        await locator.click({ timeout })
        break
      case 'input':
        await locator.fill(step.value ?? '', { timeout })
        break
      case 'change':
        await locator.selectOption(step.value ?? '', { timeout })
        break
      case 'submit':
        await locator.evaluate((el) => (el as HTMLFormElement).requestSubmit(), undefined, {
          timeout,
        })
        break
      case 'keydown':
        await locator.press(step.key ?? 'Enter', { timeout })
        break
      case 'scroll':
        await locator.evaluate(
          (el, top) => {
            ;(el as HTMLElement).scrollTop = top as number
          },
          step.scrollTop ?? 0,
          { timeout },
        )
        break
    }
    return true
  } catch {
    return false
  }
}

export async function runScenario(options: RunOptions): Promise<Trace> {
  const { url, scenario, config, probePath, headless = true, stepTimeout = 5000 } = options
  const probeSource = await readFile(probePath, 'utf8')

  const browser = await chromium.launch({ headless })
  try {
    const context = await browser.newContext({ viewport: scenario.viewport })
    const page = await context.newPage()

    await page.addInitScript(determinismScript())
    await page.addInitScript(
      ({ patterns, styleProps, scenarioId }) => {
        ;(window as unknown as Record<string, unknown>).__jqdiffConfig = {
          generatedIdPatternSources: patterns,
          styleProps,
          scenarioId,
        }
      },
      {
        patterns: config.generatedIdPatterns.map((p) => p.source),
        styleProps: config.styleProps,
        scenarioId: scenario.id,
      },
    )
    await page.addInitScript(probeSource)

    await page.goto(url, { waitUntil: 'domcontentloaded' })

    const injected = await page.evaluate(() => Boolean((window as ProbeWindow).__jqdiff))
    if (!injected) {
      throw new ProbeInjectionError(`probe を注入できなかった: ${url}`)
    }

    await settle(page, config.waitAfterStep)
    await page.evaluate(() => (window as ProbeWindow).__jqdiff!.checkpoint(null))

    for (const step of scenario.steps) {
      const resolved = await performStep(page, step, stepTimeout)
      await settle(page, config.waitAfterStep)
      await page.evaluate(
        ([s, unresolved]) =>
          (window as ProbeWindow).__jqdiff!.checkpoint(s as ScenarioStep, unresolved as boolean),
        [step, !resolved] as const,
      )
    }

    const trace = await page.evaluate(() => (window as ProbeWindow).__jqdiff!.dump())
    await context.close()
    return trace
  } finally {
    await browser.close()
  }
}
