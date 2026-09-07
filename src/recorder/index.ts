import { markInternal } from '../probe/events.js'
import { buildSelector } from '../probe/selector.js'
import type { ScenarioAction, ScenarioStep } from '../types.js'

/** 連続発火するので、同じ要素への連続分は最後の状態だけ残す */
const MERGEABLE = new Set<ScenarioAction>(['input', 'scroll'])

/** 文字入力は input が拾うので、単独で意味を持つキーだけ記録する */
const INTERESTING_KEYS = new Set([
  'Enter',
  'Escape',
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
])

/** click で既に拾える input 型。input イベントとしては記録しない */
const CLICKY_INPUT_TYPES = new Set(['checkbox', 'radio', 'file', 'button', 'submit', 'reset'])

export type RecorderOptions = {
  generatedIdPatterns: RegExp[]
  /**
   * ステップが確定するたびに呼ばれる。CLI は Playwright の exposeFunction を挿す。
   * 畳んだステップは同じ index で再送されるので、受け手は index 上書きで扱う。
   */
  onStep?: (step: ScenarioStep) => void
}

export type RecorderApi = {
  readonly steps: ScenarioStep[]
  stop(): void
}

export function installRecorder(options: RecorderOptions): RecorderApi {
  const steps: ScenarioStep[] = []
  const disposers: Array<() => void> = []

  function emit(action: ScenarioAction, el: Element, extra: Partial<ScenarioStep> = {}): void {
    const selector = buildSelector(el, options.generatedIdPatterns)
    const last = steps[steps.length - 1]
    const merge =
      last !== undefined &&
      MERGEABLE.has(action) &&
      last.action === action &&
      last.selector === selector

    const step: ScenarioStep = {
      index: merge ? last.index : steps.length,
      action,
      selector,
      ...extra,
    }

    if (merge) steps[steps.length - 1] = step
    else steps.push(step)

    options.onStep?.(step)
  }

  function on<K extends keyof DocumentEventMap>(
    type: K,
    handler: (event: DocumentEventMap[K]) => void,
  ): void {
    // capture 段で拾う。アプリ側が stopPropagation しても記録は落ちない。
    const listener = markInternal(handler as unknown as EventListener)
    document.addEventListener(type, listener, true)
    disposers.push(() => document.removeEventListener(type, listener, true))
  }

  on('click', (event) => {
    if (event.target instanceof Element) emit('click', event.target)
  })

  on('input', (event) => {
    const el = event.target
    if (el instanceof HTMLInputElement) {
      if (CLICKY_INPUT_TYPES.has(el.type)) return
      emit('input', el, { value: el.value })
      return
    }
    if (el instanceof HTMLTextAreaElement) emit('input', el, { value: el.value })
  })

  on('change', (event) => {
    // select 以外の change は click / input が既に拾っている
    if (event.target instanceof HTMLSelectElement) {
      emit('change', event.target, { value: event.target.value })
    }
  })

  on('submit', (event) => {
    if (event.target instanceof HTMLFormElement) emit('submit', event.target)
  })

  on('keydown', (event) => {
    if (event.target instanceof Element && INTERESTING_KEYS.has(event.key)) {
      emit('keydown', event.target, { key: event.key })
    }
  })

  on('scroll', (event) => {
    // scroll は bubble しないが capture 段は通るので document で拾える
    const el =
      event.target instanceof Element
        ? event.target
        : (document.scrollingElement ?? document.documentElement)
    emit('scroll', el, { scrollTop: el.scrollTop })
  })

  return {
    steps,
    stop() {
      for (const dispose of disposers) dispose()
      disposers.length = 0
    },
  }
}

type RecorderWindow = {
  __jqdiffRecorderConfig?: { generatedIdPatternSources?: string[] }
  __jqdiffStep?: (step: ScenarioStep) => void
  __jqdiffRecorder?: RecorderApi
}

/** iife バンドルとして読み込まれた時点で自動的に起動する */
if (typeof document !== 'undefined') {
  const w = globalThis as unknown as RecorderWindow
  const sources = w.__jqdiffRecorderConfig?.generatedIdPatternSources ?? []
  w.__jqdiffRecorder = installRecorder({
    generatedIdPatterns: sources.map((s) => new RegExp(s)),
    onStep: (step) => w.__jqdiffStep?.(step),
  })
}
