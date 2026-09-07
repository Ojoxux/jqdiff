import type { Diff, Finding, Severity } from '../types.js'

const SEVERITY_ORDER: Severity[] = ['critical', 'warning', 'info']

const SEVERITY_LABEL: Record<Severity, string> = {
  critical: '致命',
  warning: '要確認',
  info: '参考',
}

export type Counts = Record<Severity, number> & { structural: number }

export function summarize(diff: Diff): Counts {
  const counts: Counts = { critical: 0, warning: 0, info: 0, structural: diff.structural.length }
  for (const finding of diff.findings) counts[finding.severity] += 1
  return counts
}

function escape(value: string | null): string {
  if (value === null) return '—'
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function findingRow(finding: Finding): string {
  const prop = finding.prop ? `<code>${escape(finding.prop)}</code>` : '—'
  return `<tr class="sev-${finding.severity}">
  <td>${escape(SEVERITY_LABEL[finding.severity])}</td>
  <td>${finding.checkpointIndex}</td>
  <td>${escape(finding.kind)}</td>
  <td><code>${escape(finding.target)}</code></td>
  <td>${prop}</td>
  <td>${escape(finding.detail)}</td>
  <td class="val base">${escape(finding.baselineValue)}</td>
  <td class="val cand">${escape(finding.candidateValue)}</td>
</tr>`
}

const STYLE = `
body { font-family: system-ui, sans-serif; margin: 24px; color: #222; }
h1 { font-size: 20px; }
.meta { color: #666; font-size: 13px; margin-bottom: 16px; }
.counts span { display: inline-block; margin-right: 12px; font-weight: 600; }
.counts .critical { color: #b00020; }
.counts .warning { color: #a86400; }
.counts .info { color: #555; }
table { border-collapse: collapse; width: 100%; font-size: 13px; margin-top: 12px; }
th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #f6f6f6; }
tr.sev-critical td:first-child { color: #b00020; font-weight: 600; }
tr.sev-warning td:first-child { color: #a86400; font-weight: 600; }
tr.sev-info td:first-child { color: #777; }
td.val { font-family: ui-monospace, monospace; max-width: 240px; word-break: break-all; }
td.base { background: #fff6f6; }
td.cand { background: #f4fbf4; }
.none { padding: 24px; background: #f4fbf4; border: 1px solid #cde8cd; }
`

export function renderHtml(diff: Diff): string {
  const counts = summarize(diff)
  const findings = [...diff.findings].sort(
    (a, b) =>
      SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
      a.checkpointIndex - b.checkpointIndex,
  )

  const structural =
    diff.structural.length === 0
      ? ''
      : `<h2>構造の不一致</h2>
<p>トレースの形が揃っていないため、以下の差分比較は部分的にしか信頼できない。</p>
<table>
<tr><th>種別</th><th>checkpoint</th><th>詳細</th></tr>
${diff.structural
  .map(
    (issue) =>
      `<tr><td><code>${escape(issue.kind)}</code></td><td>${
        issue.checkpointIndex ?? '—'
      }</td><td>${escape(issue.detail)}</td></tr>`,
  )
  .join('\n')}
</table>`

  const body =
    findings.length === 0
      ? '<p class="none">差分なし。ベースラインと候補は記録した観点すべてで一致した。</p>'
      : `<table>
<tr>
  <th>重大度</th><th>checkpoint</th><th>種別</th><th>対象</th>
  <th>プロパティ</th><th>内容</th><th>ベースライン</th><th>候補</th>
</tr>
${findings.map(findingRow).join('\n')}
</table>`

  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>jqdiff report — ${escape(diff.scenarioId)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>jqdiff report</h1>
<div class="meta">
  scenario: <code>${escape(diff.scenarioId)}</code><br>
  baseline: <code>${escape(diff.baseline)}</code><br>
  candidate: <code>${escape(diff.candidate)}</code>
</div>
<div class="counts">
  <span class="critical">致命 ${counts.critical}</span>
  <span class="warning">要確認 ${counts.warning}</span>
  <span class="info">参考 ${counts.info}</span>
  <span>構造 ${counts.structural}</span>
</div>
${structural}
<h2>差分</h2>
${body}
</body>
</html>`
}
