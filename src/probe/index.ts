import type { ScenarioStep, Trace } from '../types.js'
import { collectStyles } from './computed-style.js'
import { installEventRecorder } from './events.js'
import { installMutationRecorder } from './mutations.js'
import { installNetworkRecorder } from './network.js'
import { createState } from './state.js'

export type ProbeApi = {
  checkpoint(step: ScenarioStep | null, unresolved?: boolean): void
  dump(): Trace
}

/**
 * runner が addInitScript で先に流し込む設定。
 * RegExp は構造化クローンで渡せないため文字列ソースで受け取る。
 */
type InjectedConfig = {
  generatedIdPatternSources?: string[]
  styleProps?: string[]
  scenarioId?: string
}

export function installProbe(): ProbeApi {
  const injected: InjectedConfig =
    (globalThis as { __jqdiffConfig?: InjectedConfig }).__jqdiffConfig ?? {}

  const state = createState(
    {
      generatedIdPatterns: (injected.generatedIdPatternSources ?? []).map((s) => new RegExp(s)),
      styleProps: injected.styleProps ?? [],
    },
    {
      url: location.href,
      scenarioId: injected.scenarioId ?? 'unknown',
      startedAt: new Date().toISOString(),
    },
  )

  installMutationRecorder(state)
  installNetworkRecorder(state)
  installEventRecorder(state)

  const api: ProbeApi = {
    checkpoint(step, unresolved = false) {
      // MutationObserver のコールバックはマイクロタスクなので、
      // チェックポイントを組む前に必ず同期的に吐き出させる。
      for (const flush of state.flushers) flush()

      state.checkpoints.push({
        index: state.checkpoints.length,
        step,
        unresolved,
        // 文書から外れた要素への変更は落とす。ライブラリが機能検出のために
        // 作って捨てる要素(jQuery の fieldset や計測用 div)がここで消える。
        mutations: state.pendingMutations.filter((m) => m.element.isConnected).map((m) => m.entry),
        network: state.pendingNetwork,
        events: state.pendingEvents,
        styles: collectStyles(
          state.styleTargets,
          state.config.styleProps,
          state.config.generatedIdPatterns,
        ),
      })

      state.pendingMutations = []
      state.pendingNetwork = []
      state.pendingEvents = []
      state.styleTargets.clear()
    },

    dump() {
      return { meta: state.meta, checkpoints: state.checkpoints }
    },
  }

  ;(globalThis as { __jqdiff?: ProbeApi }).__jqdiff = api
  return api
}

installProbe()
