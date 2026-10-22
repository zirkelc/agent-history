import { isMetaLine } from './transcript'
import type { ContentItem, Line } from './transcript'

/**
 * The conversation as Markdown, one section per run of consecutive messages
 * from the same role. A transcript stores each tool call as its own message,
 * so without the merge a single assistant reply would split into a section
 * per tool it called. A section carries the timestamp of its first message.
 *
 * It renders what the lines hold: filtering happens before, so the Markdown
 * and the JSONL of an export always show the same content.
 */
export function renderMarkdown(lines: Array<Line>): string {
  const sections: Array<{ role: string; timestamp?: string; parts: Array<string> }> = []
  for (const line of lines) {
    const role = roleOf(line)
    if (!role) continue
    const body = renderContent(line.message?.content)
    if (!body.trim()) continue

    const last = sections[sections.length - 1]
    if (last?.role === role) {
      last.parts.push(body)
    } else {
      sections.push({ role, timestamp: line.timestamp, parts: [body] })
    }
  }

  const text = sections
    .map(({ role, timestamp, parts }) => {
      const heading = timestamp ? `## ${role} - ${timestamp}` : `## ${role}`
      return `${heading}\n\n${parts.join('\n\n')}`
    })
    .join('\n\n')
  return text ? text + '\n' : ''
}

/** A meta line renders only when it carries a message; attachments and the like have none. */
function roleOf(line: Line): string | undefined {
  if (line.type !== 'user' && line.type !== 'assistant') return undefined
  if (isMetaLine(line)) return 'Meta'
  return line.type === 'user' ? 'User' : 'Assistant'
}

function renderContent(content: string | Array<ContentItem> | undefined): string {
  if (content === undefined) return ''
  if (typeof content === 'string') return content
  return content.map(renderItem).filter(Boolean).join('\n\n')
}

function renderItem(item: ContentItem): string {
  switch (item.type) {
    case 'text': {
      const { text } = item as { text: string }
      return text.trim() ? text : ''
    }
    case 'image':
      return '_[image omitted]_'
    case 'tool_use': {
      const { name, input } = item as { name: string; input?: unknown }
      const head = `_[Tool: ${name}]_`
      return input === undefined ? head : `${head}\n\n${fence(JSON.stringify(input, null, 2), 'json')}`
    }
    case 'tool_result': {
      const { content, is_error } = item as { content?: string | Array<ContentItem>; is_error?: boolean }
      const summary = is_error === true ? 'Tool error' : 'Tool result'
      return `<details><summary>${summary}</summary>\n\n${fence(resultText(content))}\n\n</details>`
    }
    case 'thinking': {
      const { thinking } = item as { thinking: string }
      return `<details><summary>Thinking</summary>\n\n${thinking}\n\n</details>`
    }
    default:
      return ''
  }
}

function resultText(content: string | Array<ContentItem> | undefined): string {
  if (content === undefined) return ''
  if (typeof content === 'string') return content
  return content
    .map(item => (item.type === 'text' ? (item as { text: string }).text : `[${item.type}]`))
    .join('\n')
}

/** A fence longer than any backtick run inside, so the content cannot close it. */
function fence(text: string, language = ''): string {
  const longest = Math.max(2, ...Array.from(text.matchAll(/`+/g), match => match[0].length))
  const ticks = '`'.repeat(longest + 1)
  return `${ticks}${language}\n${text}\n${ticks}`
}
