import type { Config } from './config'
import { gitInfoOf } from './git'
import type { Host } from './host'
import { factsOf, parseMeta, serializeMeta, withAgent } from './meta'
import type { AgentMeta, SessionMeta } from './meta'
import { redactSecrets } from './redact'
import { renderMarkdown } from './render'
import { filterTranscript, keepsEverything, parseTranscript, serializeTranscript } from './transcript'

/** The folder under the export folder that holds every session; the only path a commit stages. */
export const SESSIONS_DIR = 'sessions'

/** The engine refuses file reads past 4 MiB; larger transcripts stream through `cat` instead. */
const MAX_FS_READ_BYTES = 4 * 1_024 * 1_024

export type SessionSource = {
  sessionId: string
  transcriptPath: string
  /** The session's working directory, for a transcript that records none. */
  cwd: string
}

export type AgentSource = {
  sessionId: string
  agentId: string
  agentType: string
  transcriptPath: string
}

export function sessionDirOf(exportDir: string, sessionId: string): string {
  return `${exportDir}/${SESSIONS_DIR}/${sessionId}`
}

/** Writes the session's meta file and the formats the config asks for; resolves how many secrets were redacted. */
export async function exportSession(host: Host, config: Config, exportDir: string, source: SessionSource) {
  const dir = sessionDirOf(exportDir, source.sessionId)
  const raw = await readText(host, source.transcriptPath)
  const lines = parseTranscript(raw)
  const facts = factsOf(lines)

  const redacted = await writeFormats(host, config, `${dir}/${source.sessionId}`, raw)

  const cwd = facts.cwd ?? source.cwd
  const previous = parseMeta(await readIfExists(host, metaPathOf(dir, source.sessionId)))
  const meta: SessionMeta = {
    sessionId: source.sessionId,
    cwd,
    git: await gitInfoOf(host, cwd, facts.gitBranch),
    startedAt: facts.startedAt,
    updatedAt: facts.updatedAt,
    turns: facts.turns,
    agents: previous?.agents ?? [],
    export: exportInfo(config),
  }
  await host.write(metaPathOf(dir, source.sessionId), serializeMeta(meta))
  return redacted
}

/**
 * Writes the subagent's formats under its session's `agents` folder and
 * records it in the session's meta file. A session whose own export has not
 * run yet gets a meta file that holds the agent alone; the session's export
 * fills in the rest and keeps the agent.
 *
 * Resolves how many secrets were redacted, or false, with nothing written,
 * for an agent Claude Code keeps no transcript of: internal agents end like
 * any other but are never saved.
 */
export async function exportAgent(host: Host, config: Config, exportDir: string, source: AgentSource) {
  if (!(await host.exists(source.transcriptPath))) return false

  const dir = sessionDirOf(exportDir, source.sessionId)
  const raw = await readText(host, source.transcriptPath)
  const facts = factsOf(parseTranscript(raw))

  const redacted = await writeFormats(host, config, `${dir}/agents/${source.agentId}`, raw)

  const agent: AgentMeta = {
    agentId: source.agentId,
    agentType: source.agentType,
    startedAt: facts.startedAt,
    updatedAt: facts.updatedAt,
    turns: facts.turns,
  }
  const previous = parseMeta(await readIfExists(host, metaPathOf(dir, source.sessionId)))
  const meta: SessionMeta = previous ?? {
    sessionId: source.sessionId,
    git: null,
    turns: 0,
    agents: [],
    export: exportInfo(config),
  }
  await host.write(metaPathOf(dir, source.sessionId), serializeMeta({ ...meta, agents: withAgent(meta.agents, agent) }))
  return redacted
}

function metaPathOf(dir: string, sessionId: string): string {
  return `${dir}/${sessionId}.meta.json`
}

function exportInfo(config: Config): SessionMeta['export'] {
  return {
    formats: config.formats,
    filters: config.filters,
    redactSecrets: config.redactSecrets,
    exportedAt: new Date().toISOString(),
  }
}

/**
 * `base` is the path without its extension. With every filter on, the JSONL
 * is the transcript as it is, but for the secrets taken out of it. Resolves
 * the most secrets redacted from one format, since each format holds the same
 * ones.
 */
async function writeFormats(host: Host, config: Config, base: string, raw: string): Promise<number> {
  if (config.formats.length === 0) return 0

  const isWhole = keepsEverything(config.filters)
  const lines = filterTranscript(parseTranscript(raw), config.filters)
  const clean = (text: string) => (config.redactSecrets ? redactSecrets(text) : { text, count: 0 })
  let count = 0

  if (config.formats.includes('jsonl')) {
    const jsonl = clean(isWhole ? raw : serializeTranscript(lines))
    await host.write(`${base}.jsonl`, jsonl.text)
    count = Math.max(count, jsonl.count)
  }
  if (config.formats.includes('markdown')) {
    const markdown = clean(renderMarkdown(lines))
    await host.write(`${base}.md`, markdown.text)
    count = Math.max(count, markdown.count)
  }
  return count
}

async function readIfExists(host: Host, path: string): Promise<string | undefined> {
  return (await host.exists(path)) ? readText(host, path) : undefined
}

async function readText(host: Host, path: string): Promise<string> {
  const size = await host.size(path)
  return size <= MAX_FS_READ_BYTES ? host.read(path) : host.runText(['cat', path])
}
