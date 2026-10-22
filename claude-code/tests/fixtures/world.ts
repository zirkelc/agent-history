import type { Args, On, ProcessRunResult } from 'claude-code'
import { mock } from 'claude-code/testing'

export const HOME = '/home/me'
export const EXPORT_DIR = `${HOME}/history`
export const SESSION_ID = 'session-1'
export const TRANSCRIPT = '/home/me/.claude/projects/-work/session-1.jsonl'
export const CWD = '/work/app'

export const SESSION = { cwd: CWD, surface: 'terminal', isInteractive: true } as const

export const GIT_DIR = `${EXPORT_DIR}/.git`
export const INDEX_LOCK = `${GIT_DIR}/index.lock`
export const REBASE_DIR = `${GIT_DIR}/rebase-merge`

export type WorldOptions = {
  isRepo?: boolean
  remotes?: Array<string>
  pushFails?: boolean
  /** The first push is rejected as behind the remote. */
  isBehind?: boolean
  /** Paths `git diff --name-only` lists. */
  changed?: Array<string>
  /** A git older than 2.38, whose `merge-tree` has no `--write-tree`. */
  isOldGit?: boolean
  /** The local and the remote commits changed the same file. */
  isConflict?: boolean
}

/**
 * The files a `git pull --rebase` leaves when it is killed before it applies
 * its one commit: the rebase state and the index lock, as on the box where it
 * happened.
 */
export function killedPull(files: Map<string, string>, done?: string) {
  files.set(`${REBASE_DIR}/head-name`, 'refs/heads/main\n')
  files.set(`${REBASE_DIR}/onto`, 'd5ab77e\n')
  files.set(`${REBASE_DIR}/orig-head`, '2e8876b\n')
  files.set(`${REBASE_DIR}/interactive`, '')
  files.set(`${REBASE_DIR}/git-rebase-todo`, 'pick 2e8876b sync: session-0\n')
  if (done !== undefined) files.set(`${REBASE_DIR}/done`, done)
  files.set(INDEX_LOCK, '')
}

/**
 * A home directory with one transcript, an export folder and a git that
 * answers from a script. Keeps every file written, git run and status line.
 */
export function world(on: On, options: WorldOptions = {}) {
  const files = new Map<string, string>([[TRANSCRIPT, transcript()]])
  if (options.isRepo) files.set(`${EXPORT_DIR}/.git`, '')

  const runs: Array<Array<string>> = []
  /** What a run got on standard input, by its index in `runs`. */
  const stdins = new Map<number, string>()
  /** Modification times by path; a file not listed is from 1970, so it reads as old. */
  const mtimes = new Map<string, number>()
  let pushes = 0
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
      : { value: { kind: 'file', size: text.length, mtimeMs: mtimes.get(e.path) ?? 0, isLink: false } }
  })
  on('fs.write', ($, e) => {
    files.set(e.path, e.text)
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    runs.push([...e.argv])
    if (e.init?.stdin !== undefined) stdins.set(runs.length - 1, e.init.stdin)
    if (e.argv[0] === 'mv') return { value: move(files, e.argv) }
    if (e.argv[1] === 'push') pushes += 1
    return { value: gitAnswer(e, options, files, pushes) }
  })
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.end', ($, e) => ({ sessionId: e.sessionId }))
  on('session.id', () => ({ value: SESSION_ID }))
  on('command.register', () => ({ value: { command: 'agent-history' } }))
  on('classic.Stop', () => ({}))
  on('classic.SubagentStop', () => ({}))

  return {
    files,
    runs,
    stdins,
    mtimes,
    statuses,
    clock,
    gitRuns: () => runs.filter(argv => argv[0] === 'git').map(argv => argv.slice(1, 3).join(' ')),
  }
}

/** Git commands that write the index, and so take its lock. */
const INDEX_WRITERS = ['add', 'commit', 'checkout', 'read-tree', 'reset', 'stash']

function gitAnswer(
  e: Args<'process.run'>,
  options: WorldOptions,
  files: Map<string, string>,
  pushes: number,
): ProcessRunResult {
  const [, command, ...rest] = e.argv
  const ok = (stdout = '') => result(0, stdout)
  const isLocked = files.has(INDEX_LOCK) && e.init?.env?.GIT_INDEX_FILE === undefined
  const lockError = `fatal: Unable to create '${INDEX_LOCK}': File exists.`

  if (isLocked && command && INDEX_WRITERS.includes(command)) return result(128, '', lockError)

  switch (command) {
    case 'rev-parse':
      if (rest.includes('@{u}')) return result(128, '', 'fatal: no upstream configured')
      if (rest.includes('--git-common-dir')) return ok('/work/.git\n/work\n')
      if (rest.includes('--absolute-git-dir')) return ok(`${GIT_DIR}\n`)
      if (rest.some(arg => arg.startsWith('refs/remotes/'))) return ok('abc1234\nde10000\n')
      return ok('abc1234\n')
    case 'rebase':
      if (rest.includes('--abort')) {
        if (isLocked) return result(128, '', `error: Unable to create '${INDEX_LOCK}': File exists.\nfatal: could not move back to 2e8876b`)
        for (const path of [...files.keys()]) if (path.startsWith(`${REBASE_DIR}/`)) files.delete(path)
      }
      return ok()
    case 'merge-tree':
      if (options.isOldGit) return result(129, '', "error: unknown option `write-tree'")
      if (options.isConflict) return result(1, '3e4ee11\n\n1 file changed\nCONFLICT (content): Merge conflict in sessions/x.md\n')
      return ok('3e4ee00\n')
    case 'write-tree':
      return ok('7ree000\n')
    case 'commit-tree':
      return ok(rest.includes('3e4ee00') ? '3e4c000\n' : '5a95407\n')
    case 'branch':
      return ok('main\n')
    case 'remote':
      return ok((options.remotes ?? []).join('\n'))
    case 'diff':
      if (rest.includes('--name-only')) return ok((options.changed ?? []).map(path => `${path}\0`).join(''))
      return result(1)
    case 'push':
      if (options.pushFails) return result(1, '', 'fatal: could not read from remote')
      if (options.isBehind && pushes === 1) return result(1, '', '! [rejected] HEAD -> main (fetch first)')
      return ok()
    default:
      return ok()
  }
}

function move(files: Map<string, string>, argv: ReadonlyArray<string>): ProcessRunResult {
  const [from, to] = argv.slice(-2)
  const text = from === undefined ? undefined : files.get(from)
  if (text === undefined || to === undefined) return result(1, '', `mv: ${from}: No such file or directory`)
  files.delete(from as string)
  files.set(to, text)
  return result(0)
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
