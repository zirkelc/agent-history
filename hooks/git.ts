import type { ProcessRunResult } from 'claude-code'

import type { Host } from './host'
import type { GitInfo } from './meta'

/** Another session of this mod can hold the index lock of the same repository for a moment. */
const LOCK_RETRIES = 3
const LOCK_WAIT_MS = 500
const GIT_TIMEOUT_MS = 60_000

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
): Promise<ProcessRunResult> {
  let result = await host.run(['git', ...argv], { cwd, timeoutMs })
  for (let attempt = 1; attempt < LOCK_RETRIES && isLocked(result); attempt++) {
    await host.sleep(LOCK_WAIT_MS * attempt)
    result = await host.run(['git', ...argv], { cwd, timeoutMs })
  }
  return result
}

/** Like `git`, but a non-zero exit throws. */
async function gitOk(host: Host, cwd: string, argv: ReadonlyArray<string>, timeoutMs?: number) {
  const result = await git(host, cwd, argv, timeoutMs)
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
 * Pushes the current branch. A push the remote rejects as behind is rebased
 * onto the remote once and pushed again: each session writes only its own
 * folder, so the rebase does not conflict.
 */
export async function push(host: Host, dir: string, state: RepoState, timeoutMs?: number): Promise<void> {
  if (!state.remote || !state.branch) throw new Error('no remote or no branch to push')

  const argv = ['push', '--quiet', '-u', state.remote, `HEAD:${state.branch}`]
  const first = await git(host, dir, argv, timeoutMs)
  if (first.exitCode === 0) return

  const isBehind = /rejected|fetch first|non-fast-forward/.test(first.stderr)
  if (!isBehind) throw new GitError(argv, first)

  await gitOk(host, dir, ['pull', '--quiet', '--rebase', '--autostash', state.remote, state.branch], timeoutMs)
  await gitOk(host, dir, argv, timeoutMs)
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
