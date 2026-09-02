export type Severity = 'critical' | 'warning' | 'info'

export type ScenarioAction = 'click' | 'input' | 'change' | 'submit' | 'keydown' | 'scroll'

export type ScenarioStep = {
  index: number
  action: ScenarioAction
  selector: string
  value?: string
  key?: string
  scrollTop?: number
}

export type Scenario = {
  id: string
  recordedAt: string
  startUrl: string
  viewport: { width: number; height: number }
  steps: ScenarioStep[]
}

export type MutationEntry = {
  type: 'attributes' | 'childList' | 'characterData'
  target: string
  attributeName?: string
  oldValue?: string | null
  newValue?: string | null
  added?: string[]
  removed?: string[]
}

export type NetworkEntry = {
  transport: 'xhr' | 'fetch'
  method: string
  url: string
  headers: Record<string, string>
  body: string | null
  status: number | null
  ok: boolean
}

export type EventEntry = {
  type: string
  target: string
  currentTarget: string
  phase: 'capture' | 'target' | 'bubble'
  defaultPreventedBefore: boolean
  defaultPreventedAfter: boolean
  propagationStoppedAfter: boolean
}

export type Checkpoint = {
  index: number
  step: ScenarioStep | null
  unresolved: boolean
  mutations: MutationEntry[]
  network: NetworkEntry[]
  events: EventEntry[]
  styles: Record<string, Record<string, string>>
}

export type Trace = {
  meta: { url: string; scenarioId: string; startedAt: string }
  checkpoints: Checkpoint[]
}

export type DiffKind = 'network' | 'event' | 'style' | 'mutation'

/** compare 層が出す、セベリティ判定前の生の差分 */
export type RawDiff = {
  kind: DiffKind
  target: string
  prop?: string
  detail: string
  baselineValue: string | null
  candidateValue: string | null
}

export type Finding = RawDiff & {
  checkpointIndex: number
  severity: Severity
}

export type StructuralIssue = {
  kind: 'checkpoint-count-mismatch' | 'unresolved-selector' | 'probe-injection-failed'
  checkpointIndex: number | null
  detail: string
}

export type Diff = {
  scenarioId: string
  baseline: string
  candidate: string
  structural: StructuralIssue[]
  findings: Finding[]
}

export type JqdiffConfig = {
  generatedIdPatterns: RegExp[]
  styleProps: string[]
  ignore: {
    selectors: string[]
    styleProps: string[]
    headers: string[]
    urls: (string | RegExp)[]
  }
  severityOverrides: Record<string, Severity>
  waitAfterStep: number
}
