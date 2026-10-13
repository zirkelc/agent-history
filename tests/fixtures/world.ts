import type { Args, On, ProcessRunResult } from 'claude-code'
import { mock } from 'claude-code/testing'

export const HOME = '/home/me'
export const EXPORT_DIR = `${HOME}/history`
export const SESSION_ID = 'session-1'
export const TRANSCRIPT = '/home/me/.claude/projects/-work/session-1.jsonl'
export const CWD = '/work/app'

export const SESSION = { cwd: CWD, surface: 'terminal', isInteractive: true } as const

export type WorldOptions = {
  isRepo?: boolean
  remotes?: Array<string>
  pushFails?: boolean
}

/**
 * A home directory with one transcript, an export folder and a git that
 * answers from a script. Keeps every file written, git run and status line.
 */
export function world(on: On, options: WorldOptions = {}) {
  const files = new Map<string, string>([[TRANSCRIPT, transcript()]])
  if (options.isRepo) files.set(`${EXPORT_DIR}/.git`, '')

  const runs: Array<Array<string>> = []
  const statuses: Array<string | undefined> = []
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 12, 12, 0) })
  mock.env(on, { HOME })

  on('fs.exists', ($, e) => ({ value: files.has(e.path) }))
  on('fs.read', ($, e) => {
    const text = files.get(e.path)
    return text === undefined ? { deny: `ENOENT ${e.path}` } : { value: text }
  })
  on('fs.stat', ($, e) => {
    const text = files.get(e.path)
    return text === undefined
      ? { deny: `ENOENT ${e.path}` }
      : { value: { kind: 'file', size: text.length, mtimeMs: 0, isLink: false } }
  })
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    return { value: gitAnswer(e, options) }
  })
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('command.register', () => ({ value: { command: 'agent-history' } }))
  on('classic.Stop', () => ({}))
  on('classic.SubagentStop', () => ({}))

  return { files, runs, statuses, clock, gitRuns: () => runs.map(argv => argv.slice(1, 3).join(' ')) }
}

function gitAnswer(e: Args<'process.run'>, options: WorldOptions): ProcessRunResult {
  const [, command, ...rest] = e.argv
  const ok = (stdout = '') => result(0, stdout)

  switch (command) {
    case 'rev-parse':
      if (rest.includes('@{u}')) return result(128, '', 'fatal: no upstream configured')
      if (rest.includes('--git-common-dir')) return ok('/work/.git\n/work\n')
      return ok('abc1234\n')
    case 'branch':
      return ok('main\n')
    case 'remote':
      return ok((options.remotes ?? []).join('\n'))
    case 'diff':
      return result(1)
    case 'push':
      return options.pushFails ? result(1, '', 'fatal: could not read from remote') : ok()
    default:
      return ok()
  }
}

function result(exitCode: number, stdout = '', stderr = ''): ProcessRunResult {
  return { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false }
}

/** One prompt, a reply with a tool call, its result, and a reminder Claude Code injected. */
export function transcript(): string {
  const lines = [
    { type: 'user', uuid: 'u1', timestamp: '2026-10-12T09:00:00.000Z', cwd: CWD, gitBranch: 'feat-x', message: { role: 'user', content: 'Fix the bug' } },
    { type: 'user', uuid: 'm1', timestamp: '2026-10-12T09:00:00.500Z', isMeta: true, message: { role: 'user', content: '<system-reminder>x</system-reminder>' } },
    {
      type: 'assistant',
      uuid: 'a1',
      timestamp: '2026-10-12T09:00:01.000Z',
      message: {
        role: 'assistant',
        model: 'claude-opus-5-5',
        content: [
          { type: 'thinking', thinking: 'hmm', signature: 's' },
          { type: 'text', text: 'Looking.' },
          { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
        ],
      },
    },
    { type: 'user', uuid: 'r1', timestamp: '2026-10-12T09:00:02.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a.ts' }] } },
    { type: 'assistant', uuid: 'a2', timestamp: '2026-10-13T10:00:00.000Z', message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Done.' }] } },
  ]
  return lines.map(line => JSON.stringify(line) + '\n').join('')
}
