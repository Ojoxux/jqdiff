import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { loadConfig } from './config.js'
import { diffTraces, hasBlockingIssues } from './differ/index.js'
import { renderHtml, summarize } from './reporter/html.js'
import type { Diff, Scenario, ScenarioStep } from './types.js'

export class UsageError extends Error {}

export type RecordArgs = { command: 'record'; url: string; out: string }
export type RunArgs = {
  command: 'run'
  scenario: string
  baseline: string
  candidate: string
  out: string
  headed: boolean
}
export type ReportArgs = { command: 'report'; diff: string; out: string }
export type Args = RecordArgs | RunArgs | ReportArgs

const USAGE = `使い方:
  jqdiff record <url> -o <scenario.json>
  jqdiff run <scenario.json> --baseline <url> --candidate <url> -o <outDir> [--headed]
  jqdiff report <diff.json> -o <report.html>`

function required(value: string | undefined, name: string): string {
  if (value === undefined || value === '') throw new UsageError(`${name} が必要です\n\n${USAGE}`)
  return value
}

export function parseArgv(argv: string[]): Args {
  const [command, ...rest] = argv
  if (command === undefined) throw new UsageError(USAGE)

  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: {
      out: { type: 'string', short: 'o' },
      baseline: { type: 'string' },
      candidate: { type: 'string' },
      headed: { type: 'boolean', default: false },
    },
  })

  switch (command) {
    case 'record':
      return {
        command: 'record',
        url: required(positionals[0], '<url>'),
        out: required(values.out, '-o'),
      }
    case 'run':
      return {
        command: 'run',
        scenario: required(positionals[0], '<scenario.json>'),
        baseline: required(values.baseline, '--baseline'),
        candidate: required(values.candidate, '--candidate'),
        out: required(values.out, '-o'),
        headed: values.headed === true,
      }
    case 'report':
      return {
        command: 'report',
        diff: required(positionals[0], '<diff.json>'),
        out: required(values.out, '-o'),
      }
    default:
      throw new UsageError(`未知のサブコマンド: ${command}\n\n${USAGE}`)
  }
}

/** dist/cli.js から見た同梱バンドルの場所 */
function bundlePath(name: 'probe' | 'recorder'): string {
  return fileURLToPath(new URL(`./${name}/index.global.js`, import.meta.url))
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

export async function cmdRecord(args: RecordArgs): Promise<number> {
  const { chromium } = await import('playwright')
  const config = await loadConfig(process.cwd())
  const viewport = { width: 1280, height: 800 }
  const steps: ScenarioStep[] = []

  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()

  // 畳んだステップは同じ index で再送されるので、index を鍵に上書きする
  await context.exposeFunction('__jqdiffStep', (step: ScenarioStep) => {
    steps[step.index] = step
  })
  await page.addInitScript(
    ({ patterns }) => {
      ;(window as unknown as Record<string, unknown>).__jqdiffRecorderConfig = {
        generatedIdPatternSources: patterns,
      }
    },
    { patterns: config.generatedIdPatterns.map((p) => p.source) },
  )
  await page.addInitScript(await readFile(bundlePath('recorder'), 'utf8'))

  await page.goto(args.url, { waitUntil: 'domcontentloaded' })
  console.error('記録中。操作を終えたらブラウザを閉じるか Ctrl+C を押してください。')

  await new Promise<void>((done) => {
    const finish = (): void => done()
    browser.on('disconnected', finish)
    process.once('SIGINT', finish)
  })

  await browser.close().catch(() => {})

  const scenario: Scenario = {
    id: `s-${Date.now()}`,
    recordedAt: new Date().toISOString(),
    startUrl: args.url,
    viewport,
    // exposeFunction は非同期なので取りこぼしがありうる。穴は落として詰める。
    steps: steps
      .filter((s): s is ScenarioStep => s !== undefined)
      .map((s, i) => ({ ...s, index: i })),
  }

  await mkdir(dirname(resolve(args.out)), { recursive: true })
  await writeFile(args.out, `${JSON.stringify(scenario, null, 2)}\n`)
  console.error(`${scenario.steps.length} ステップを ${args.out} に保存しました。`)
  return 0
}

export async function cmdRun(args: RunArgs): Promise<number> {
  // report サブコマンドをブラウザ非搭載の環境でも動かしたいので、
  // playwright に触る runner はここで初めて読み込む。
  const { runScenario } = await import('./runner/index.js')
  const config = await loadConfig(process.cwd())
  const scenario = await readJson<Scenario>(args.scenario)
  const probePath = bundlePath('probe')

  const common = { scenario, config, probePath, headless: !args.headed }
  // 直列に回す。並列にすると fixture サーバやアプリ側の共有状態で差分が揺れる。
  const baselineTrace = await runScenario({ ...common, url: args.baseline })
  const candidateTrace = await runScenario({ ...common, url: args.candidate })

  const diff = diffTraces(baselineTrace, candidateTrace, config)
  diff.baseline = args.baseline
  diff.candidate = args.candidate

  await mkdir(args.out, { recursive: true })
  await writeFile(join(args.out, 'baseline.trace.json'), JSON.stringify(baselineTrace, null, 2))
  await writeFile(join(args.out, 'candidate.trace.json'), JSON.stringify(candidateTrace, null, 2))
  await writeFile(join(args.out, 'diff.json'), JSON.stringify(diff, null, 2))
  await writeFile(join(args.out, 'report.html'), renderHtml(diff))

  printSummary(diff, join(args.out, 'report.html'))
  return hasBlockingIssues(diff) ? 1 : 0
}

export async function cmdReport(args: ReportArgs): Promise<number> {
  const diff = await readJson<Diff>(args.diff)
  await mkdir(dirname(resolve(args.out)), { recursive: true })
  await writeFile(args.out, renderHtml(diff))
  printSummary(diff, args.out)
  return hasBlockingIssues(diff) ? 1 : 0
}

function printSummary(diff: Diff, htmlPath: string): void {
  const c = summarize(diff)
  console.error(
    `致命 ${c.critical} / 要確認 ${c.warning} / 参考 ${c.info} / 構造 ${c.structural}  → ${htmlPath}`,
  )
}

export async function main(argv: string[]): Promise<number> {
  let args: Args
  try {
    args = parseArgv(argv)
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message)
      return 2
    }
    throw error
  }

  switch (args.command) {
    case 'record':
      return cmdRecord(args)
    case 'run':
      return cmdRun(args)
    case 'report':
      return cmdReport(args)
  }
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error)
      process.exit(1)
    },
  )
}
