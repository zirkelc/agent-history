import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import type { ProcessRunInit, ProcessRunResult } from 'claude-code'

import type { Host } from '../../claude-code/hooks/host'
import type { AgentHistoryLogEntry, AgentHistoryStatus } from '../../claude-code/types'

/**
 * Git must not read the config of the machine that runs the tests: a signing
 * key or a hook there would change what git does. The `GIT_*` variables of
 * the parent process go too: a git hook, such as the pre-commit hook that runs
 * these tests, sets `GIT_DIR` and `GIT_INDEX_FILE`, which would point every
 * git command here at the repository being committed.
 */
const PARENT_ENV = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')))

const GIT_ENV = {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
}

/** Runs before each process of the host; it can run other git commands first, as another session would. */
export type BeforeRun = (argv: ReadonlyArray<string>) => Promise<void> | void

export type NodeHost = Host & {
  statusValue: () => AgentHistoryStatus
  log: Array<AgentHistoryLogEntry>
}

/** A host that runs real processes and reads real files, with the status and the log in memory. */
export function nodeHost(options: { beforeRun?: BeforeRun; pending?: Array<string> } = {}): NodeHost {
  let status: AgentHistoryStatus = { mode: 'unset', pending: options.pending ?? [] }
  const log: Array<AgentHistoryLogEntry> = []

  return {
    run: async (argv, init) => {
      await options.beforeRun?.(argv)
      return run(argv, init)
    },
    runText: async argv => (await run(argv)).stdout,
    read: async path => readFileSync(path, 'utf8'),
    write: async (path, text) => writeFile(path, text),
    exists: async path => existsSync(path),
    size: async path => statSync(path).size,
    mtime: async path => statSync(path).mtimeMs,
    home: async () => undefined,
    now: async () => Date.now(),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    after: (ms, fn) => {
      const handle = setTimeout(fn, ms)
      return { cancel: () => clearTimeout(handle) } as never
    },
    status: () => undefined,
    readStatus: async () => status,
    updateStatus: async change => {
      status = change(status)
      return status
    },
    updateLog: async change => {
      const next = change(log)
      log.splice(0, log.length, ...next)
      return log
    },
    statusValue: () => status,
    log,
  }
}

function run(argv: ReadonlyArray<string>, init: ProcessRunInit = {}): Promise<ProcessRunResult> {
  return new Promise((resolve, reject) => {
    const [command, ...args] = argv
    const child = spawn(command ?? '', args, { cwd: init.cwd, env: { ...PARENT_ENV, ...GIT_ENV, ...init.env } })
    const stdout: Array<Buffer> = []
    const stderr: Array<Buffer> = []
    child.stdout.on('data', chunk => stdout.push(chunk))
    child.stderr.on('data', chunk => stderr.push(chunk))
    child.on('error', reject)
    child.on('close', code =>
      resolve({
        exitCode: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        isStdoutTruncated: false,
        isStderrTruncated: false,
      }),
    )
    child.stdin.end(init.stdin ?? '')
  })
}

/** Runs git and throws on a non-zero exit; for the setup and the checks of a test. */
export function sh(cwd: string, ...args: Array<string>): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env: { ...PARENT_ENV, ...GIT_ENV } })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

export function writeFile(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

export function readFile(path: string): string {
  return readFileSync(path, 'utf8')
}

/**
 * A bare remote and two clones of it, as two machines that push to one
 * branch. The first clone made the first commit; the second cloned after it.
 */
export function machines() {
  const root = mkdtempSync(join(tmpdir(), 'agent-history-'))
  const remote = join(root, 'remote.git')
  const a = join(root, 'a')
  const b = join(root, 'b')

  sh(root, 'init', '--quiet', '--bare', '--initial-branch=main', remote)
  sh(root, 'clone', '--quiet', remote, a)
  sh(a, 'switch', '--quiet', '-c', 'main')
  writeFile(join(a, 'sessions/s0/s0.jsonl'), line('s0-1'))
  sh(a, 'add', '-A')
  sh(a, 'commit', '--quiet', '-m', 'first')
  sh(a, 'push', '--quiet', '-u', 'origin', 'main')
  sh(root, 'clone', '--quiet', remote, b)

  return { root, remote, a, b }
}

/** One transcript line with its uuid. */
export function line(uuid: string): string {
  return JSON.stringify({ type: 'user', uuid, message: { role: 'user', content: uuid } }) + '\n'
}

/** Writes a session's three files, its transcript made of the lines with these uuids. */
export function writeSession(dir: string, sessionId: string, uuids: Array<string>) {
  const base = join(dir, 'sessions', sessionId, sessionId)
  writeFile(`${base}.jsonl`, uuids.map(line).join(''))
  writeFile(`${base}.md`, uuids.map(uuid => `## ${uuid}\n`).join('\n'))
  writeFile(`${base}.meta.json`, JSON.stringify({ sessionId, turns: uuids.length }, null, 2) + '\n')
}

export function commitAll(dir: string, message: string) {
  sh(dir, 'add', '-A')
  sh(dir, 'commit', '--quiet', '-m', message)
}
