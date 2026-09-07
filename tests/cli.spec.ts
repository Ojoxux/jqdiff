import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cmdReport, parseArgv, UsageError } from '../src/cli.js'
import type { Diff } from '../src/types.js'

describe('parseArgv', () => {
  it('record を解析する', () => {
    expect(parseArgv(['record', 'http://x/', '-o', 's.json'])).toEqual({
      command: 'record',
      url: 'http://x/',
      out: 's.json',
    })
  })

  it('run を解析する', () => {
    expect(
      parseArgv([
        'run',
        's.json',
        '--baseline',
        'http://x/jquery',
        '--candidate',
        'http://x/native',
        '-o',
        'out',
      ]),
    ).toEqual({
      command: 'run',
      scenario: 's.json',
      baseline: 'http://x/jquery',
      candidate: 'http://x/native',
      out: 'out',
      headed: false,
    })
  })

  it('run の --headed を拾う', () => {
    const parsed = parseArgv([
      'run',
      's.json',
      '--baseline',
      'a',
      '--candidate',
      'b',
      '-o',
      'o',
      '--headed',
    ])
    expect(parsed).toMatchObject({ headed: true })
  })

  it('report を解析する', () => {
    expect(parseArgv(['report', 'd.json', '-o', 'r.html'])).toEqual({
      command: 'report',
      diff: 'd.json',
      out: 'r.html',
    })
  })

  it('未知のサブコマンドは UsageError', () => {
    expect(() => parseArgv(['frobnicate'])).toThrow(UsageError)
  })

  it('サブコマンドなしは UsageError', () => {
    expect(() => parseArgv([])).toThrow(UsageError)
  })

  it('run で --baseline が無ければ UsageError', () => {
    expect(() => parseArgv(['run', 's.json', '--candidate', 'b', '-o', 'o'])).toThrow(UsageError)
  })

  it('record で -o が無ければ UsageError', () => {
    expect(() => parseArgv(['record', 'http://x/'])).toThrow(UsageError)
  })
})

describe('cmdReport', () => {
  const diff: Diff = {
    scenarioId: 's1',
    baseline: 'a',
    candidate: 'b',
    structural: [],
    findings: [
      {
        kind: 'style',
        target: '#badge',
        prop: 'display',
        detail: 'display が異なる',
        baselineValue: 'inline-flex',
        candidateValue: 'block',
        checkpointIndex: 1,
        severity: 'critical',
      },
    ],
  }

  it('diff.json から HTML を書き出し、critical があれば 1 を返す', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jqdiff-'))
    const diffPath = join(dir, 'diff.json')
    const htmlPath = join(dir, 'report.html')
    await writeFile(diffPath, JSON.stringify(diff))

    const code = await cmdReport({ command: 'report', diff: diffPath, out: htmlPath })

    expect(code).toBe(1)
    expect(await readFile(htmlPath, 'utf8')).toContain('#badge')
  })

  it('差分が無ければ 0 を返す', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jqdiff-'))
    const diffPath = join(dir, 'diff.json')
    await writeFile(diffPath, JSON.stringify({ ...diff, findings: [] }))

    const code = await cmdReport({
      command: 'report',
      diff: diffPath,
      out: join(dir, 'report.html'),
    })

    expect(code).toBe(0)
  })
})
