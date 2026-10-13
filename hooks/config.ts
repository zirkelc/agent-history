import type { PluginOptions } from 'claude-code'

import type { Format } from './meta'
import type { Filters } from './transcript'

export type Config = {
  /** As the person wrote it; `~` is expanded once the home directory is known. */
  exportDir: string
  formats: Array<Format>
  filters: Filters
  autoPush: boolean
  commitDelayMs: number
}

const DEFAULT_COMMIT_DELAY_SECONDS = 60

/** The options are untyped at run time, so each value is checked and falls back to its manifest default. */
export function configOf(options: PluginOptions): Config {
  const flag = (key: string, fallback: boolean) => (typeof options[key] === 'boolean' ? (options[key] as boolean) : fallback)
  const seconds = typeof options.commitDelaySeconds === 'number' ? options.commitDelaySeconds : DEFAULT_COMMIT_DELAY_SECONDS

  const formats: Array<Format> = []
  if (flag('exportJsonl', true)) formats.push('jsonl')
  if (flag('exportMarkdown', true)) formats.push('markdown')

  return {
    exportDir: typeof options.exportDir === 'string' ? options.exportDir.trim() : '',
    formats,
    filters: {
      text: flag('includeText', true),
      toolUse: flag('includeToolUse', true),
      toolInput: flag('includeToolInput', false),
      toolResults: flag('includeToolResults', false),
      thinking: flag('includeThinking', false),
      meta: flag('includeMeta', false),
    },
    autoPush: flag('autoPush', true),
    commitDelayMs: Math.max(0, seconds) * 1_000,
  }
}

export function expandHome(path: string, home: string | undefined): string {
  if (!home) return path
  if (path === '~') return home
  return path.startsWith('~/') ? `${home}${path.slice(1)}` : path
}
