import { describe, expect, test } from 'claude-code/testing'

import { renderMarkdown } from '../hooks/render'
import { factsOf, withAgent } from '../hooks/meta'
import { filterTranscript, keepsEverything, parseTranscript } from '../hooks/transcript'
import type { Filters } from '../hooks/transcript'
import { transcript } from './fixtures/world'

const TEXT_ONLY: Filters = { text: true, toolUse: false, toolInput: false, toolResults: false, thinking: false, meta: false }
const ALL: Filters = { text: true, toolUse: true, toolInput: true, toolResults: true, thinking: true, meta: true }

describe('transcript', () => {
  test('text only keeps the prompt and the replies, nothing else', () => {
    // Arrange
    const lines = parseTranscript(transcript())

    // Act
    const kept = filterTranscript(lines, TEXT_ONLY)

    // Assert
    expect(kept.map(line => line.uuid)).toEqual(['u1', 'a1', 'a2'])
    expect(kept[1]?.message?.content).toEqual([{ type: 'text', text: 'Looking.' }])
  })

  test('tool calls keep the tool name and drop the input unless asked', () => {
    // Arrange
    const lines = parseTranscript(transcript())

    // Act
    const withoutInput = filterTranscript(lines, { ...TEXT_ONLY, toolUse: true })
    const withInput = filterTranscript(lines, { ...TEXT_ONLY, toolUse: true, toolInput: true })

    // Assert
    expect(withoutInput[1]?.message?.content).toEqual([
      { type: 'text', text: 'Looking.' },
      { type: 'tool_use', id: 't1', name: 'Bash' },
    ])
    expect(withInput[1]?.message?.content).toEqual([
      { type: 'text', text: 'Looking.' },
      { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } },
    ])
  })

  test('meta, thinking and tool results come back when switched on', () => {
    // Arrange
    const lines = parseTranscript(transcript())

    // Act
    const kept = filterTranscript(lines, ALL)

    // Assert
    expect(kept.map(line => line.uuid)).toEqual(['u1', 'm1', 'a1', 'r1', 'a2'])
    expect(keepsEverything(ALL)).toBe(true)
    expect(keepsEverything(TEXT_ONLY)).toBe(false)
  })

  test('filtering a filtered transcript changes nothing', () => {
    // Arrange
    const once = filterTranscript(parseTranscript(transcript()), { ...TEXT_ONLY, toolUse: true })

    // Act
    const twice = filterTranscript(once, { ...TEXT_ONLY, toolUse: true })

    // Assert
    expect(twice).toEqual(once)
  })

  test('a torn last line is skipped', () => {
    // Arrange
    const raw = transcript() + '{"type":"user","mess'

    // Act
    const lines = parseTranscript(raw)

    // Assert
    expect(lines.length).toBe(5)
  })
})

describe('render', () => {
  test('merges messages of one role and shows each tool call by name', () => {
    // Arrange
    const kept = filterTranscript(parseTranscript(transcript()), { ...TEXT_ONLY, toolUse: true })

    // Act
    const markdown = renderMarkdown(kept)

    // Assert
    expect(markdown).toBe(
      [
        '## User - 2026-10-12T09:00:00.000Z',
        '',
        'Fix the bug',
        '',
        '## Assistant - 2026-10-12T09:00:01.000Z',
        '',
        'Looking.',
        '',
        '_[Tool: Bash]_',
        '',
        'Done.',
        '',
      ].join('\n'),
    )
  })
})

describe('meta', () => {
  test('reads the span, the branch and the prompts of a session', () => {
    // Arrange
    const lines = parseTranscript(transcript())

    // Act
    const facts = factsOf(lines)

    // Assert
    expect(facts).toEqual({
      cwd: '/work/app',
      gitBranch: 'feat-x',
      startedAt: '2026-10-12T09:00:00.000Z',
      updatedAt: '2026-10-13T10:00:00.000Z',
      turns: 1,
    })
  })

  test('an agent exported again replaces its earlier entry', () => {
    // Arrange
    const first = { agentId: 'b', agentType: 'Explore', startedAt: '2', turns: 1 }
    const other = { agentId: 'a', agentType: 'Plan', startedAt: '1', turns: 1 }

    // Act
    const agents = withAgent([first, other], { ...first, turns: 3 })

    // Assert
    expect(agents).toEqual([other, { ...first, turns: 3 }])
  })
})
