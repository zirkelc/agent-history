import type { Timer } from 'claude-code'

import type { AgentHistoryLogEntry, AgentHistoryMode, AgentHistoryStatus } from '../types'
import { expandHome } from './config'
import type { Config } from './config'
import { SESSIONS_DIR, exportAgent, exportSession } from './exporter'
import type { AgentSource, SessionSource } from './exporter'
import { commit, initRepo, push, repoState } from './git'
import type { Host } from './host'
import type { RepoState } from './git'

const MAX_LOG = 50

export type Sync = ReturnType<typeof createSync>

/**
 * The export and git work of one session. Every step runs on one queue, so
 * exports and commits never overlap within the session; other sessions that
 * share the export folder are covered by the retries of the git helpers.
 */
export function createSync(host: Host, config: Config) {
  let exportDir = ''
  let repo: RepoState = { isRepo: false }
  let queue: Promise<unknown> = Promise.resolve()
  let timer: Timer | undefined
  /** The last transcript seen per session, exported once more when the session ends. */
  const sources = new Map<string, SessionSource>()

  function enqueue<T>(task: () => Promise<T>): Promise<T | undefined> {
    const run = queue.then(task).catch(() => undefined)
    queue = run
    return run
  }

  async function record(step: AgentHistoryLogEntry['step'], isOk: boolean, message: string) {
    const entry: AgentHistoryLogEntry = { at: await host.now(), step, isOk, message }
    await host.updateLog(list => [...list, entry].slice(-MAX_LOG))
  }

  async function setStatus(change: (value: AgentHistoryStatus) => AgentHistoryStatus) {
    const next = await host.updateStatus(change)
    host.status(statusLine(next))
  }

  async function fail(step: AgentHistoryLogEntry['step'], error: unknown) {
    /** The engine names the mod before its own errors; the panel already says whose they are. */
    const message = (error instanceof Error ? error.message : String(error)).replace(/^agent-history: /, '')
    await record(step, false, message)
    await setStatus(value => ({ ...value, warning: `${step} failed` }))
  }

  /** Reads the export folder and the repository; changes nothing on disk. */
  async function check() {
    const home = await host.home()
    exportDir = expandHome(config.exportDir, home).replace(/\/+$/, '')

    if (!exportDir) {
      repo = { isRepo: false }
      await setStatus(value => ({ ...value, mode: 'unset', repo: undefined, warning: 'set the export folder in /config' }))
      return
    }

    try {
      repo = await repoState(host, exportDir)
    } catch (error) {
      repo = { isRepo: false }
      await fail('check', error)
      return
    }

    const mode: AgentHistoryMode = !repo.isRepo ? 'export-only' : repo.remote && config.autoPush ? 'push' : 'commit'
    const warning = repo.isRepo && !repo.remote ? 'no remote' : undefined
    await setStatus(value => ({ ...value, mode, repo: { exportDir, ...repo }, warning }))
  }

  function schedule() {
    if (!repo.isRepo) return
    timer?.cancel()
    timer = host.after(config.commitDelayMs, () => {
      timer = undefined
      void enqueue(commitAndPush)
    })
  }

  async function exported(sessionId: string, message: string) {
    const at = await host.now()
    await record('export', true, message)
    await setStatus(value => ({
      ...value,
      lastExportAt: at,
      pending: value.pending.includes(sessionId) ? value.pending : [...value.pending, sessionId],
      warning: value.warning === 'export failed' ? undefined : value.warning,
    }))
    schedule()
  }

  async function commitAndPush(timeoutMs?: number) {
    if (!repo.isRepo) return

    const { pending } = await host.readStatus()
    const message = pending.length > 0 ? `sync: ${pending.join(', ')}` : 'sync'

    let sha: string | undefined
    try {
      sha = await commit(host, exportDir, [SESSIONS_DIR], message)
    } catch (error) {
      return fail('commit', error)
    }

    const at = await host.now()
    if (sha) await record('commit', true, `${sha} ${message}`)
    await setStatus(value => ({
      ...value,
      pending: value.pending.filter(id => !pending.includes(id)),
      lastCommit: sha ? { sha, at } : value.lastCommit,
      warning: value.warning === 'commit failed' ? undefined : value.warning,
    }))

    if (!config.autoPush || !repo.remote) return
    try {
      await push(host, exportDir, repo, timeoutMs)
    } catch (error) {
      return fail('push', error)
    }
    await record('push', true, `${repo.remote}/${repo.branch ?? ''}`)
    await setStatus(value => ({
      ...value,
      lastPushAt: at,
      warning: value.warning === 'push failed' ? undefined : value.warning,
    }))
  }

  return {
    check: () => enqueue(check),

    exportSession(source: SessionSource) {
      sources.set(source.sessionId, source)
      return enqueue(async () => {
        if (!exportDir) return
        let redacted = 0
        try {
          redacted = await exportSession(host, config, exportDir, source)
        } catch (error) {
          return fail('export', error)
        }
        await exported(source.sessionId, `session ${source.sessionId}${redactedNote(redacted)}`)
      })
    },

    exportAgent(source: AgentSource) {
      return enqueue(async () => {
        if (!exportDir) return
        let redacted = 0
        try {
          const result = await exportAgent(host, config, exportDir, source)
          if (result === false) return
          redacted = result
        } catch (error) {
          return fail('export', error)
        }
        await exported(source.sessionId, `agent ${source.agentType} ${source.agentId}${redactedNote(redacted)}`)
      })
    },

    /** Reads the repository again, since a remote can be added at any time, then commits and pushes without waiting for the timer. */
    syncNow(timeoutMs?: number) {
      timer?.cancel()
      timer = undefined
      return enqueue(async () => {
        await check()
        await commitAndPush(timeoutMs)
      })
    },

    /** Exports the session one last time, then commits and pushes within the time the end leaves. */
    async end(sessionId: string, timeoutMs: number) {
      const source = sources.get(sessionId)
      if (source) await this.exportSession(source)
      timer?.cancel()
      timer = undefined
      /** No new check of the repository here: the end's time is short, and the start's check stands. */
      await enqueue(() => commitAndPush(timeoutMs))
    },

    /** Turns the export folder into a repository; only ever on the person's request. */
    initRepo() {
      return enqueue(async () => {
        if (!exportDir) return
        try {
          await initRepo(host, exportDir)
        } catch (error) {
          return fail('init', error)
        }
        await record('init', true, exportDir)
        await check()
      })
    },

    dispose() {
      timer?.cancel()
      timer = undefined
    },
  }
}

/**
 * The status line: the warning while one stands, otherwise none. Claude Code
 * draws every mod's status line as a warning with the mod's name in front, so
 * a line for a good state would read as a problem.
 */
export function statusLine(value: AgentHistoryStatus): string | undefined {
  return value.warning
}

// The log's note for secrets taken out of an export; nothing when there were none.
function redactedNote(count: number): string {
  return count === 0 ? '' : ` · ${count} secret${count === 1 ? '' : 's'} redacted`
}

export function clockTime(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}
