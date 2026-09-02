import type {
  Checkpoint,
  Diff,
  Finding,
  JqdiffConfig,
  Severity,
  StructuralIssue,
  Trace,
} from '../types.js'
import { classify } from './classify.js'
import { compareEvents, compareMutations, compareNetwork, compareStyles } from './compare.js'
import { normalizeTrace } from './normalize.js'

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }

/** セレクタごとに、baseline と candidate の computed style が全一致するかを判定する。 */
function computedStyleEqualBySelector(a: Checkpoint, b: Checkpoint): Map<string, boolean> {
  const result = new Map<string, boolean>()
  const selectors = new Set([...Object.keys(a.styles), ...Object.keys(b.styles)])

  for (const selector of selectors) {
    const x = a.styles[selector]
    const y = b.styles[selector]
    if (!x || !y) {
      // 片側でしか採取されていない場合は「一致している」とは言えない
      result.set(selector, false)
      continue
    }
    const props = new Set([...Object.keys(x), ...Object.keys(y)])
    let equal = true
    for (const p of props) {
      if (x[p] !== y[p]) {
        equal = false
        break
      }
    }
    result.set(selector, equal)
  }

  return result
}

export function diffTraces(baselineRaw: Trace, candidateRaw: Trace, config: JqdiffConfig): Diff {
  const baseline = normalizeTrace(baselineRaw, config.generatedIdPatterns)
  const candidate = normalizeTrace(candidateRaw, config.generatedIdPatterns)

  const structural: StructuralIssue[] = []
  const findings: Finding[] = []

  if (baseline.checkpoints.length !== candidate.checkpoints.length) {
    structural.push({
      kind: 'checkpoint-count-mismatch',
      checkpointIndex: null,
      detail: `チェックポイント数が異なる (baseline: ${baseline.checkpoints.length}, candidate: ${candidate.checkpoints.length})`,
    })
  }

  const pairCount = Math.min(baseline.checkpoints.length, candidate.checkpoints.length)

  for (let i = 0; i < pairCount; i++) {
    const a = baseline.checkpoints[i]!
    const b = candidate.checkpoints[i]!

    if (a.unresolved || b.unresolved) {
      structural.push({
        kind: 'unresolved-selector',
        checkpointIndex: i,
        detail: `チェックポイント ${i} でセレクタが解決できなかったため比較対象から除外した (${(a.step ?? b.step)?.selector ?? '不明'})`,
      })
      continue
    }

    const styleEqual = computedStyleEqualBySelector(a, b)

    const raws = [
      ...compareNetwork(a.network, b.network, config.ignore),
      ...compareEvents(a.events, b.events),
      ...compareStyles(a.styles, b.styles, config.ignore),
      ...compareMutations(a.mutations, b.mutations, config.ignore),
    ]

    for (const raw of raws) {
      const severity = classify(
        raw,
        { computedStyleEqual: styleEqual.get(raw.target) ?? false },
        config.severityOverrides,
      )
      findings.push({ ...raw, checkpointIndex: i, severity })
    }
  }

  findings.sort((x, y) => {
    const s = SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity]
    if (s !== 0) return s
    return x.checkpointIndex - y.checkpointIndex
  })

  return {
    scenarioId: baseline.meta.scenarioId,
    baseline: baseline.meta.url,
    candidate: candidate.meta.url,
    structural,
    findings,
  }
}

export function hasBlockingIssues(diff: Diff): boolean {
  return diff.structural.length > 0 || diff.findings.some((f) => f.severity === 'critical')
}
