/**
 * Parses a Claude Code transcript and reduces it to the content types the
 * person chose to keep.
 *
 * Filtering is idempotent: a filtered transcript filters to itself under the
 * same filters, so an exported file can pass through it again.
 */

export type ContentItem =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'tool_use'; id: string; name: string; input?: unknown }
  | { type: 'tool_result'; tool_use_id: string; content?: string | Array<ContentItem>; is_error?: boolean }
  | { type: 'image'; source?: unknown }
  | { type: string; [key: string]: unknown }

export type Line = {
  type: string
  uuid?: string
  timestamp?: string
  cwd?: string
  gitBranch?: string
  isMeta?: boolean
  isCompactSummary?: boolean
  message?: { role?: string; model?: string; content?: string | Array<ContentItem> }
  [key: string]: unknown
}

export type Filters = {
  text: boolean
  toolUse: boolean
  toolInput: boolean
  toolResults: boolean
  thinking: boolean
  meta: boolean
}

/** Marks assistant messages that Claude Code generated itself, such as API errors. */
const SYNTHETIC_MODEL = '<synthetic>'

/** Lines that do not parse are skipped: one torn line must not cost the rest of the session. */
export function parseTranscript(raw: string): Array<Line> {
  const lines: Array<Line> = []
  for (const text of raw.split('\n')) {
    if (!text.trim()) continue
    try {
      lines.push(JSON.parse(text) as Line)
    } catch {
      /** A partial last line while the session still writes. */
    }
  }
  return lines
}

export function serializeTranscript(lines: Array<Line>): string {
  return lines.map(line => JSON.stringify(line) + '\n').join('')
}

/** With every filter on, the transcript is kept whole and can be copied as it is. */
export function keepsEverything(filters: Filters): boolean {
  return Object.values(filters).every(Boolean)
}

/**
 * Whether a line is one Claude Code added itself rather than a message the
 * person or the model wrote: reminders, attachments, system rows, summaries
 * and synthetic assistant messages.
 */
export function isMetaLine(line: Line): boolean {
  if (line.type !== 'user' && line.type !== 'assistant') return true
  if (line.isMeta === true) return true
  return line.message?.model === SYNTHETIC_MODEL
}

/**
 * Keeps the lines and content blocks the filters allow. User and assistant
 * messages are reduced to a fixed set of fields; a meta line, when kept, is
 * kept whole. A message left with no content is dropped, which is what
 * becomes of a user message that only carried tool results when those are off.
 */
export function filterTranscript(lines: Array<Line>, filters: Filters): Array<Line> {
  const out: Array<Line> = []
  for (const line of lines) {
    if (isMetaLine(line)) {
      if (filters.meta) out.push(line)
      continue
    }
    if (!line.message) continue

    const content = filterContent(line.message.content, filters)
    if (content === undefined) continue

    const kept: Line = { type: line.type }
    if (line.uuid) kept.uuid = line.uuid
    if (line.timestamp) kept.timestamp = line.timestamp
    if (line.cwd) kept.cwd = line.cwd
    if (line.gitBranch) kept.gitBranch = line.gitBranch
    if (line.isCompactSummary) kept.isCompactSummary = true

    kept.message = {}
    if (line.message.role) kept.message.role = line.message.role
    if (line.message.model) kept.message.model = line.message.model
    kept.message.content = content

    out.push(kept)
  }
  return out
}

/** The kept content, or undefined when nothing is left. */
function filterContent(
  content: string | Array<ContentItem> | undefined,
  filters: Filters,
): string | Array<ContentItem> | undefined {
  if (typeof content === 'string') return filters.text && content.trim() ? content : undefined
  if (!Array.isArray(content)) return undefined

  const kept: Array<ContentItem> = []
  for (const item of content) {
    const block = filterBlock(item, filters)
    if (block) kept.push(block)
  }
  return kept.length > 0 ? kept : undefined
}

function filterBlock(item: ContentItem, filters: Filters): ContentItem | undefined {
  switch (item.type) {
    case 'text': {
      const text = (item as { text: string }).text
      return filters.text && text.trim() ? { type: 'text', text } : undefined
    }
    case 'image':
      return filters.text ? { type: 'image' } : undefined
    case 'tool_use': {
      if (!filters.toolUse) return undefined
      const { id, name, input } = item as { id: string; name: string; input?: unknown }
      return filters.toolInput && input !== undefined ? { type: 'tool_use', id, name, input } : { type: 'tool_use', id, name }
    }
    case 'tool_result':
      return filters.toolResults ? item : undefined
    case 'thinking': {
      const { thinking } = item as { thinking: string }
      return filters.thinking && thinking.trim() ? { type: 'thinking', thinking } : undefined
    }
    default:
      return undefined
  }
}
