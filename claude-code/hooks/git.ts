import type { ProcessRunInit, ProcessRunResult } from 'claude-code'

import type { Host } from './host'
import type { GitInfo } from './meta'

/** Another session of this mod can hold the index lock of the same repository for a moment. */
const LOCK_RETRIES = 3
const LOCK_WAIT_MS = 500
const GIT_TIMEOUT_MS = 60_000

/**
 * The engine stops every git process of this mod within its timeout, so an
 * index lock or a rebase older than this, which has not moved since, belongs
 * to a git process that was killed. The margin covers a clock that is off.
 */
const STALE_AFTER_MS = 2 * GIT_TIMEOUT_MS

/** Keeps the export files of a repair, so they can be got back if the repair stops half way. */
const REPAIR_REF = 'refs/agent-history/repair'

export class GitError extends Error {
  constructor(argv: ReadonlyArray<string>, result: ProcessRunResult) {
    const detail = (result.stderr || result.stdout).trim().split('\n').slice(-1)[0] ?? ''
    super(`git ${argv[0] ?? ''} failed (${result.exitCode})${detail ? `: ${detail}` : ''}`)
  }
}

/** Runs git in `cwd`, again after a short wait while another process holds the index lock. */
export async function git(
  host: Host,
  cwd: string,
  argv: ReadonlyArray<string>,
  timeoutMs = GIT_TIMEOUT_MS,
  init: Pick<ProcessRunInit, 'env' | 'stdin'> = {},
): Promise<ProcessRunResult> {
  let result = await host.run(['git', ...argv], { ...init, cwd, timeoutMs })
  for (let attempt = 1; attempt < LOCK_RETRIES && isLocked(result); attempt++) {
    await host.sleep(LOCK_WAIT_MS * attempt)
    result = await host.run(['git', ...argv], { ...init, cwd, timeoutMs })
  }
  return result
}

/** Like `git`, but a non-zero exit throws. */
async function gitOk(
  host: Host,
  cwd: string,
  argv: ReadonlyArray<string>,
  timeoutMs?: number,
  init?: Pick<ProcessRunInit, 'env' | 'stdin'>,
) {
  const result = await git(host, cwd, argv, timeoutMs, init)
  if (result.exitCode !== 0) throw new GitError(argv, result)
  return result.stdout.trim()
}

function isLocked(result: ProcessRunResult): boolean {
  return result.exitCode !== 0 && result.stderr.includes('index.lock')
}

/** The export folder as git sees it. */
export type RepoState = {
  isRepo: boolean
  remote?: string
  branch?: string
}

/**
 * Whether the folder is the root of a repository, and its push target. A
 * folder inside some other repository does not count: commits there would
 * land in a repository the person did not pick.
 */
export async function repoState(host: Host, dir: string): Promise<RepoState> {
  if (!(await host.exists(`${dir}/.git`))) return { isRepo: false }

  const branch = (await git(host, dir, ['branch', '--show-current'])).stdout.trim() || undefined
  const upstream = await git(host, dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (upstream.exitCode === 0) {
    const remote = upstream.stdout.trim().split('/')[0]
    return { isRepo: true, branch, remote }
  }

  const remotes = (await git(host, dir, ['remote'])).stdout.trim().split('\n').filter(Boolean)
  const remote = remotes.includes('origin') ? 'origin' : remotes[0]
  return { isRepo: true, branch, remote }
}

export async function initRepo(host: Host, dir: string): Promise<void> {
  await gitOk(host, dir, ['init'])
}

/**
 * Stages the given paths and commits them. Resolves the new commit's short
 * sha, or undefined when nothing under the paths changed.
 */
export async function commit(
  host: Host,
  dir: string,
  paths: ReadonlyArray<string>,
  message: string,
): Promise<string | undefined> {
  await gitOk(host, dir, ['add', '-A', '--', ...paths])
  const staged = await git(host, dir, ['diff', '--cached', '--quiet', '--', ...paths])
  if (staged.exitCode === 0) return undefined

  await gitOk(host, dir, ['commit', '--quiet', '--no-verify', '-m', message, '--', ...paths])
  return gitOk(host, dir, ['rev-parse', '--short', 'HEAD'])
}

/**
 * Pushes the current branch. A push the remote rejects as behind fetches the
 * remote and pushes a merge of the two: each session writes only its own
 * folder, so the merge does not conflict.
 *
 * The fetch is the slow step and the one the short timeout of the session's
 * end can kill; a killed fetch leaves nothing half done. The merge is made in
 * memory and pushed before the branch, the index and the work tree move, so a
 * kill can leave at most a stale index lock, which the next sync repairs. A
 * git older than 2.38 cannot merge in memory and rebases instead.
 */
export async function push(host: Host, dir: string, state: RepoState, timeoutMs?: number): Promise<void> {
  if (!state.remote || !state.branch) throw new Error('no remote or no branch to push')

  const argv = ['push', '--quiet', '-u', state.remote, `HEAD:${state.branch}`]
  const first = await git(host, dir, argv, timeoutMs)
  if (first.exitCode === 0) return

  const isBehind = /rejected|fetch first|non-fast-forward/.test(first.stderr)
  if (!isBehind) throw new GitError(argv, first)

  const tracking = `refs/remotes/${state.remote}/${state.branch}`
  await gitOk(host, dir, ['fetch', '--quiet', state.remote, `+refs/heads/${state.branch}:${tracking}`], timeoutMs)
  const merged = await mergeAndPush(host, dir, state.remote, state.branch, tracking, timeoutMs)
  if (merged) return

  await rebaseOnto(host, dir, tracking)
  await gitOk(host, dir, argv, timeoutMs)
}

/**
 * Merges the fetched remote into HEAD without the index or the work tree,
 * pushes the merge, then moves the branch to it. The branch moves only from
 * the commit the merge started from, so a commit another session made in the
 * meantime is not lost; the next push merges it. Resolves false when git has
 * no in-memory merge.
 */
async function mergeAndPush(
  host: Host,
  dir: string,
  remote: string,
  branch: string,
  tracking: string,
  timeoutMs?: number,
): Promise<boolean> {
  const [head, theirs] = (await gitOk(host, dir, ['rev-parse', 'HEAD^{commit}', `${tracking}^{commit}`])).split('\n')
  if (!head || !theirs) throw new Error(`could not read HEAD and ${tracking}`)

  const merge = ['merge-tree', '--write-tree', head, theirs]
  const result = await git(host, dir, merge)
  if (result.exitCode > 1) return false
  if (result.exitCode === 1) {
    const conflicts = result.stdout.split('\n').filter(line => line.startsWith('CONFLICT')).map(line => line.replace(/^CONFLICT \([^)]*\): /, ''))
    throw new Error(`the remote changed the same files: ${conflicts.join(', ')}; merge ${tracking} by hand`)
  }

  const tree = result.stdout.trim().split('\n')[0] ?? ''
  const commit = await gitOk(host, dir, ['commit-tree', tree, '-p', head, '-p', theirs, '-m', `sync: merge ${remote}/${branch}`])
  await gitOk(host, dir, ['push', '--quiet', remote, `${commit}:refs/heads/${branch}`], timeoutMs)
  await gitOk(host, dir, ['read-tree', '-m', '-u', head, commit])
  await gitOk(host, dir, ['update-ref', `refs/heads/${branch}`, commit, head])
  return true
}

/** Rebases the branch onto the fetched remote. A rebase that fails is aborted at once, so the next sync does not find it half done. */
async function rebaseOnto(host: Host, dir: string, tracking: string): Promise<void> {
  const rebase = ['rebase', '--quiet', '--autostash', tracking]
  const rebased = await git(host, dir, rebase)
  if (rebased.exitCode !== 0) {
    await git(host, dir, ['rebase', '--abort'])
    throw new GitError(rebase, rebased)
  }
}

/** A rebase left in the repository: by `git rebase` with either backend, or by `git am`. */
type HalfRebase = {
  isAm: boolean
  /** Whether it has commands other than `pick`, or stopped by itself, as for an `edit` or a conflict: then a person started it or must go on with it. */
  isForPerson: boolean
  modifiedAt: number
}

/**
 * Repairs what a git process of this mod leaves when it is killed: an index
 * lock that no process holds any more, and a rebase that a sync started and
 * never finished: the rebase of a git without an in-memory merge, or the
 * `git pull --rebase` of earlier versions of this mod. Every later commit fails on either until they
 * are gone. Resolves what it did, or undefined when there was nothing to do.
 *
 * It repairs only what is old enough that no live git process works on it,
 * and only a rebase that has nothing but picks and did not stop for a person.
 * It aborts that rebase, which puts the branch back on its local commits; the
 * next push that the remote rejects rebases them again. The abort resets the
 * work tree, so the export files in it are first kept in a commit under
 * `refs/agent-history/repair`, and written back after the abort. Anything
 * else throws and says what a person has to do.
 */
export async function repair(host: Host, dir: string, paths: ReadonlyArray<string>): Promise<string | undefined> {
  const gitDir = await gitOk(host, dir, ['rev-parse', '--absolute-git-dir'])
  const lock = `${gitDir}/index.lock`
  const hasLock = await host.exists(lock)
  const rebase = await halfRebase(host, gitDir)
  if (!hasLock && !rebase) return undefined

  const now = await host.now()
  if (hasLock && now - (await host.mtime(lock)) < STALE_AFTER_MS) {
    throw new Error(`another git process holds ${lock}; trying again at the next sync`)
  }
  if (rebase) {
    if (rebase.isAm) throw new Error(`git am is in progress in ${dir}; finish it, or run git am --abort there`)
    const unmerged = await gitOk(host, dir, ['ls-files', '--unmerged'])
    if (rebase.isForPerson || unmerged) {
      throw new Error(`a rebase in ${dir} waits for a person; finish it with git rebase --continue, or run git rebase --abort there`)
    }
    if (now - rebase.modifiedAt < STALE_AFTER_MS) {
      throw new Error(`a rebase is running in ${dir}; trying again at the next sync`)
    }
  }

  const done: Array<string> = []
  const kept = rebase ? await keepFiles(host, dir, gitDir, paths) : undefined
  if (hasLock) {
    const moved = await host.run(['mv', '-f', lock, `${lock}.stale`], { cwd: dir })
    if (moved.exitCode !== 0) throw new Error(`could not move the stale ${lock} away: ${moved.stderr.trim()}`)
    done.push('moved a stale index.lock away')
  }
  if (kept) {
    await gitOk(host, dir, ['reset', '--quiet', '--hard'])
    await gitOk(host, dir, ['clean', '-f', '-d', '-q', '--', ...paths])
    await gitOk(host, dir, ['rebase', '--abort'])
    if (kept.changed.length > 0) {
      const stdin = kept.changed.map(path => `${path}\0`).join('')
      await gitOk(host, dir, ['checkout', kept.commit, '--pathspec-from-file=-', '--pathspec-file-nul'], undefined, { stdin })
    }
    done.push(`aborted a rebase that was killed, kept ${kept.changed.length} export file${kept.changed.length === 1 ? '' : 's'}`)
  }
  return done.join(', ')
}

async function halfRebase(host: Host, gitDir: string): Promise<HalfRebase | undefined> {
  const merge = `${gitDir}/rebase-merge`
  if (await host.exists(`${merge}/head-name`)) {
    const todo = `${merge}/git-rebase-todo`
    const lines = [await readIf(host, `${merge}/done`), await readIf(host, todo)].join('\n').split('\n')
    const commands = lines.map(line => line.trim()).filter(line => line && !line.startsWith('#'))
    const isForPerson = commands.some(line => !line.startsWith('pick ')) || (await host.exists(`${merge}/stopped-sha`))
    return { isAm: false, isForPerson, modifiedAt: await newest(host, [todo, `${merge}/head-name`]) }
  }

  const apply = `${gitDir}/rebase-apply`
  if (await host.exists(apply)) {
    const isAm = !(await host.exists(`${apply}/rebasing`))
    return { isAm, isForPerson: false, modifiedAt: await newest(host, [`${apply}/next`, apply]) }
  }
  return undefined
}

/**
 * Writes the export files as they are in the work tree to a commit, through
 * an index of its own: the repository's index may be locked. Resolves the
 * commit and the files that differ from HEAD, which the abort would lose.
 */
async function keepFiles(host: Host, dir: string, gitDir: string, paths: ReadonlyArray<string>) {
  const env = { GIT_INDEX_FILE: `${gitDir}/agent-history-repair-index` }
  await gitOk(host, dir, ['read-tree', 'HEAD'], undefined, { env })
  await gitOk(host, dir, ['add', '-A', '--', ...paths], undefined, { env })
  const tree = await gitOk(host, dir, ['write-tree'], undefined, { env })
  const commit = await gitOk(host, dir, ['commit-tree', tree, '-p', 'HEAD', '-m', 'agent-history: export files before a repair'])
  await gitOk(host, dir, ['update-ref', REPAIR_REF, commit])
  const diff = await gitOk(host, dir, ['diff', '--name-only', '-z', '--no-renames', '--diff-filter=d', 'HEAD', commit, '--', ...paths])
  return { commit, changed: diff.split('\0').filter(Boolean) }
}

async function readIf(host: Host, path: string): Promise<string> {
  return (await host.exists(path)) ? host.read(path) : ''
}

/** The newest modification time of the paths that exist. */
async function newest(host: Host, paths: ReadonlyArray<string>): Promise<number> {
  let at = 0
  for (const path of paths) if (await host.exists(path)) at = Math.max(at, await host.mtime(path))
  return at
}

/**
 * The repository a session's working directory belongs to. The name comes
 * from the common git dir, not the working tree root: a worktree's root is
 * named after its branch, and every worktree of a repository should agree.
 * Resolves null outside a repository or when the directory is gone.
 */
export async function gitInfoOf(host: Host, cwd: string, branch: string | undefined): Promise<GitInfo | null> {
  const result = await git(host, cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir', '--show-toplevel'])
  if (result.exitCode !== 0) return null

  const [commonDir, worktree] = result.stdout.trim().split('\n')
  if (!commonDir || !worktree) return null

  const root = basename(commonDir) === '.git' ? dirname(commonDir) : commonDir
  const repo = basename(root).replace(/\.git$/, '') || basename(worktree)
  const current = branch ?? ((await git(host, cwd, ['branch', '--show-current'])).stdout.trim() || undefined)

  return { repo, branch: current, worktree }
}

function basename(path: string): string {
  return path.replace(/\/+$/, '').split('/').pop() ?? ''
}

function dirname(path: string): string {
  return path.replace(/\/+$/, '').split('/').slice(0, -1).join('/') || '/'
}
