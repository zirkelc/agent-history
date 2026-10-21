import { describe, expect, test } from 'claude-code/testing'

import { CWD, EXPORT_DIR, SESSION, SESSION_ID, TRANSCRIPT, world } from './fixtures/world'

const OPTIONS = { options: { exportDir: '~/history' } }
const COMMIT_DELAY_MS = 60_000
const SESSION_DIR = `${EXPORT_DIR}/sessions/${SESSION_ID}`
const STOP = { session_id: SESSION_ID, transcript_path: TRANSCRIPT, cwd: CWD, stop_hook_active: false }

describe('register', () => {
  test('exports the session as meta, JSONL and Markdown', OPTIONS, async ($, on) => {
    // Arrange
    const w = world(on)
    await $.session.start(SESSION)

    // Act
    await $.classic.Stop(STOP)
    await w.clock.settle()

    // Assert
    const meta = JSON.parse(w.files.get(`${SESSION_DIR}/${SESSION_ID}.meta.json`) ?? '{}')
    expect(meta.git).toEqual({ repo: 'work', branch: 'feat-x', worktree: '/work' })
    expect(meta.startedAt).toBe('2026-10-12T09:00:00.000Z')
    expect(meta.updatedAt).toBe('2026-10-13T10:00:00.000Z')
    expect(meta.export.formats).toEqual(['jsonl', 'markdown'])
    expect(w.files.get(`${SESSION_DIR}/${SESSION_ID}.jsonl`)?.split('\n').filter(Boolean).length).toBe(3)
    expect(w.files.get(`${SESSION_DIR}/${SESSION_ID}.md`)).toContain('_[Tool: Bash]_')
  })

  test('an unset export folder warns to set it and exports nothing', async ($, on) => {
    // Arrange
    const w = world(on)
    await $.session.start(SESSION)

    // Act
    await $.classic.Stop(STOP)
    await w.clock.advance(COMMIT_DELAY_MS)

    // Assert
    expect([...w.files.keys()].filter(path => path.includes('/sessions/')).length).toBe(0)
    expect(w.statuses[w.statuses.length - 1]).toBe('set the export folder in /config')
  })

  test('a folder that is no repository gets no git: no init, no commit, no warning', OPTIONS, async ($, on) => {
    // Arrange
    const w = world(on)
    await $.session.start(SESSION)

    // Act
    await $.classic.Stop(STOP)
    await w.clock.advance(COMMIT_DELAY_MS)

    // Assert
    expect(w.gitRuns().filter(run => !run.startsWith('rev-parse --path-format') && !run.startsWith('branch'))).toEqual([])
    expect(w.statuses[w.statuses.length - 1]).toBe(undefined)
  })

  test('a repository with a remote commits and pushes after the delay', OPTIONS, async ($, on) => {
    // Arrange
    const w = world(on, { isRepo: true, remotes: ['origin'] })
    await $.session.start(SESSION)
    await $.classic.Stop(STOP)
    await w.clock.settle()
    const before = w.gitRuns().filter(run => run.startsWith('commit') || run.startsWith('push'))

    // Act
    await w.clock.advance(COMMIT_DELAY_MS)

    // Assert
    expect(before).toEqual([])
    expect(w.gitRuns().filter(run => run.startsWith('commit') || run.startsWith('push'))).toEqual([
      'commit --quiet',
      'push --quiet',
    ])
    const push = w.runs.find(argv => argv[1] === 'push')
    expect(push).toEqual(['git', 'push', '--quiet', '-u', 'origin', 'HEAD:main'])
  })

  test('a repository without a remote commits and warns', OPTIONS, async ($, on) => {
    // Arrange
    const w = world(on, { isRepo: true })
    await $.session.start(SESSION)

    // Act
    await $.classic.Stop(STOP)
    await w.clock.advance(COMMIT_DELAY_MS)

    // Assert
    expect(w.gitRuns().filter(run => run.startsWith('commit') || run.startsWith('push'))).toEqual(['commit --quiet'])
    expect(w.statuses[w.statuses.length - 1]).toBe('no remote')
  })

  test('a remote added after the start is found when the panel syncs', OPTIONS, async ($, on) => {
    // Arrange
    const remotes: Array<string> = []
    const w = world(on, { isRepo: true, remotes })
    await $.session.start(SESSION)
    await $.classic.Stop(STOP)
    await w.clock.settle()
    remotes.push('origin')

    // Act
    await $.command.run({ command: 'agent-history', args: '', origin: { kind: 'human' } as never, presentation: {} as never })
    await w.clock.settle()
    const ui = await $.ui.mount({
      plugin: 'agent-history',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'agent-history',
      props: { title: 'agent-history', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { bodyRows: 30 } as never, view: {} as never },
    })
    await ui.press({ key: 'sync' })
    await w.clock.settle()

    // Assert
    expect(w.gitRuns().filter(run => run.startsWith('push')).length).toBe(1)
    expect(w.statuses[w.statuses.length - 1]).toBe(undefined)
    await ui.unmount()
  })

  test('a failed push shows a warning in the status line', OPTIONS, async ($, on) => {
    // Arrange
    const w = world(on, { isRepo: true, remotes: ['origin'], pushFails: true })
    await $.session.start(SESSION)

    // Act
    await $.classic.Stop(STOP)
    await w.clock.advance(COMMIT_DELAY_MS)

    // Assert
    expect(w.statuses[w.statuses.length - 1]).toBe('push failed')
  })

  test('turns close together make one commit', OPTIONS, async ($, on) => {
    // Arrange
    const w = world(on, { isRepo: true, remotes: ['origin'] })
    await $.session.start(SESSION)

    // Act
    await $.classic.Stop(STOP)
    await w.clock.advance(COMMIT_DELAY_MS / 2)
    await $.classic.Stop(STOP)
    await w.clock.advance(COMMIT_DELAY_MS)

    // Assert
    expect(w.gitRuns().filter(run => run.startsWith('commit')).length).toBe(1)
  })

  test('the end of the session commits and pushes at once', OPTIONS, async ($, on) => {
    // Arrange
    const w = world(on, { isRepo: true, remotes: ['origin'] })
    await $.session.start(SESSION)
    await $.classic.Stop(STOP)
    await w.clock.settle()

    // Act
    await $.session.end({ reason: 'prompt_input_exit', sessionId: SESSION_ID, resume: { id: SESSION_ID } as never })

    // Assert
    expect(w.gitRuns().filter(run => run.startsWith('commit') || run.startsWith('push'))).toEqual([
      'commit --quiet',
      'push --quiet',
    ])
  })

  test('a subagent is exported under its session and listed in the meta', OPTIONS, async ($, on) => {
    // Arrange
    const w = world(on)
    const agentPath = '/home/me/.claude/projects/-work/session-1/subagents/agent-a1.jsonl'
    w.files.set(agentPath, w.files.get(TRANSCRIPT) ?? '')
    await $.session.start(SESSION)

    // Act
    await $.classic.SubagentStop({
      ...STOP,
      agent_id: 'a1',
      agent_type: 'Explore',
      agent_transcript_path: agentPath,
    })
    await $.classic.Stop(STOP)
    await w.clock.settle()

    // Assert
    expect(w.files.has(`${SESSION_DIR}/agents/a1.jsonl`)).toBe(true)
    expect(w.files.has(`${SESSION_DIR}/agents/a1.md`)).toBe(true)
    const meta = JSON.parse(w.files.get(`${SESSION_DIR}/${SESSION_ID}.meta.json`) ?? '{}')
    expect(meta.agents).toEqual([
      { agentId: 'a1', agentType: 'Explore', startedAt: '2026-10-12T09:00:00.000Z', updatedAt: '2026-10-13T10:00:00.000Z', turns: 1 },
    ])
    expect(meta.turns).toBe(1)
  })

  test('an agent with no saved transcript is skipped without a warning', OPTIONS, async ($, on) => {
    // Arrange
    const w = world(on)
    await $.session.start(SESSION)
    await $.classic.Stop(STOP)
    await w.clock.settle()

    // Act
    await $.classic.SubagentStop({
      ...STOP,
      agent_id: 'internal',
      agent_type: 'classifier',
      agent_transcript_path: '/home/me/.claude/projects/-work/session-1/subagents/agent-internal.jsonl',
    })
    await w.clock.settle()

    // Assert
    expect(w.files.has(`${SESSION_DIR}/agents/internal.jsonl`)).toBe(false)
    expect(w.statuses[w.statuses.length - 1]).toBe(undefined)
  })

  test('a secret in the transcript is redacted in every exported file', OPTIONS, async ($, on) => {
    // Arrange
    const w = world(on)
    const secret = 'sk-' + 'ant-api03-' + 'Ab1'.repeat(10)
    w.files.set(TRANSCRIPT, (w.files.get(TRANSCRIPT) ?? '').replace('Fix the bug', `Fix the bug, the key is ${secret}`))
    await $.session.start(SESSION)

    // Act
    await $.classic.Stop(STOP)
    await w.clock.settle()

    // Assert
    const jsonl = w.files.get(`${SESSION_DIR}/${SESSION_ID}.jsonl`) ?? ''
    const markdown = w.files.get(`${SESSION_DIR}/${SESSION_ID}.md`) ?? ''
    expect(jsonl.includes(secret) || markdown.includes(secret)).toBe(false)
    expect(markdown).toContain('the key is [REDACTED:anthropic]')
    expect(JSON.parse(jsonl.split('\n')[0] ?? '').message.content).toBe('Fix the bug, the key is [REDACTED:anthropic]')
    expect(JSON.parse(w.files.get(`${SESSION_DIR}/${SESSION_ID}.meta.json`) ?? '{}').export.redactSecrets).toBe(true)
  })

  test('with redaction off, a secret is exported as it is', { options: { exportDir: '~/history', redactSecrets: false } }, async ($, on) => {
    // Arrange
    const w = world(on)
    const secret = 'sk-' + 'ant-api03-' + 'Ab1'.repeat(10)
    w.files.set(TRANSCRIPT, (w.files.get(TRANSCRIPT) ?? '').replace('Fix the bug', `Fix the bug, the key is ${secret}`))
    await $.session.start(SESSION)

    // Act
    await $.classic.Stop(STOP)
    await w.clock.settle()

    // Assert
    expect(w.files.get(`${SESSION_DIR}/${SESSION_ID}.md`)).toContain(secret)
  })

  test('a secret in the transcript warns in the status line and is logged once', OPTIONS, async ($, on) => {
    // Arrange
    const w = world(on)
    w.files.set(TRANSCRIPT, withSecret(w.files.get(TRANSCRIPT) ?? ''))
    await $.session.start(SESSION)

    // Act
    await $.classic.Stop(STOP)
    await $.classic.Stop(STOP)
    await w.clock.settle()

    // Assert
    expect(w.statuses[w.statuses.length - 1]).toBe('1 secret redacted in this session')
    const ui = await mountPane($)
    const secretRows = (await logTexts(ui)).filter(text => text.includes('secret'))
    expect(secretRows.length).toBe(1)
    expect(secretRows[0]).toContain('1 new secret redacted (anthropic)')
    expect((await ui.find({ key: 'status' }))?.text).toBe('⚠ 1 secret redacted in this session')
    await ui.unmount()
  })

  test('secrets of the session and its agents add up', OPTIONS, async ($, on) => {
    // Arrange
    const w = world(on)
    const agentPath = '/home/me/.claude/projects/-work/session-1/subagents/agent-a1.jsonl'
    w.files.set(TRANSCRIPT, withSecret(w.files.get(TRANSCRIPT) ?? ''))
    w.files.set(agentPath, w.files.get(TRANSCRIPT) ?? '')
    await $.session.start(SESSION)

    // Act
    await $.classic.SubagentStop({ ...STOP, agent_id: 'a1', agent_type: 'Explore', agent_transcript_path: agentPath })
    await $.classic.Stop(STOP)
    await w.clock.settle()

    // Assert
    expect(w.statuses[w.statuses.length - 1]).toBe('2 secrets redacted in this session')
  })

  test('opening the panel clears the secret warning until a new secret is found', OPTIONS, async ($, on) => {
    // Arrange
    const w = world(on)
    w.files.set(TRANSCRIPT, withSecret(w.files.get(TRANSCRIPT) ?? ''))
    await $.session.start(SESSION)
    await $.classic.Stop(STOP)
    await w.clock.settle()

    // Act
    await $.command.run({ command: 'agent-history', args: '', origin: { kind: 'human' } as never, presentation: {} as never })
    await w.clock.settle()
    const afterOpen = w.statuses[w.statuses.length - 1]
    await $.classic.Stop(STOP)
    await w.clock.settle()
    const afterSameSecret = w.statuses[w.statuses.length - 1]
    w.files.set(TRANSCRIPT, (w.files.get(TRANSCRIPT) ?? '').replace('Done.', `Done, also ${'gh' + 'p_' + 'Ef3'.repeat(12)}`))
    await $.classic.Stop(STOP)
    await w.clock.settle()

    // Assert
    expect(afterOpen).toBe(undefined)
    expect(afterSameSecret).toBe(undefined)
    expect(w.statuses[w.statuses.length - 1]).toBe('2 secrets redacted in this session')
  })

  test('a failed push has priority over the secret warning', OPTIONS, async ($, on) => {
    // Arrange
    const w = world(on, { isRepo: true, remotes: ['origin'], pushFails: true })
    w.files.set(TRANSCRIPT, withSecret(w.files.get(TRANSCRIPT) ?? ''))
    await $.session.start(SESSION)

    // Act
    await $.classic.Stop(STOP)
    await w.clock.advance(COMMIT_DELAY_MS)

    // Assert
    expect(w.statuses[w.statuses.length - 1]).toBe('push failed')
  })

  test('with redaction off, the warning says the secrets were exported', { options: { exportDir: '~/history', redactSecrets: false } }, async ($, on) => {
    // Arrange
    const w = world(on)
    w.files.set(TRANSCRIPT, withSecret(w.files.get(TRANSCRIPT) ?? ''))
    await $.session.start(SESSION)

    // Act
    await $.classic.Stop(STOP)
    await w.clock.settle()

    // Assert
    expect(w.statuses[w.statuses.length - 1]).toBe('1 possible secret exported in this session (redaction is off)')
  })

  test('formats and filters follow the config', { options: { exportDir: '~/history', exportMarkdown: false, includeToolUse: false } }, async ($, on) => {
    // Arrange
    const w = world(on)
    await $.session.start(SESSION)

    // Act
    await $.classic.Stop(STOP)
    await w.clock.settle()

    // Assert
    expect(w.files.has(`${SESSION_DIR}/${SESSION_ID}.md`)).toBe(false)
    expect(w.files.get(`${SESSION_DIR}/${SESSION_ID}.jsonl`)).not.toContain('tool_use')
  })
})

const SECRET = 'sk-' + 'ant-api03-' + 'Ab1'.repeat(10)

function withSecret(text: string): string {
  return text.replace('Fix the bug', `Fix the bug, the key is ${SECRET}`)
}

function mountPane($: Parameters<Parameters<typeof test>[2]>[0]) {
  return $.ui.mount({
    plugin: 'agent-history',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'agent-history',
    props: { title: 'agent-history', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: { bodyRows: 30 } as never, view: {} as never },
  })
}

// The text of each log row, newest first.
async function logTexts(ui: Awaited<ReturnType<typeof mountPane>>): Promise<Array<string>> {
  const texts: Array<string> = []
  for (let at = 0; ; at += 1) {
    const row = await ui.find({ key: `log:${at}` })
    if (!row) return texts
    texts.push(row.text)
  }
}

describe('pane', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`offers git init for a plain folder and runs it on press (${surface})`, OPTIONS, async ($, on) => {
      // Arrange
      const w = world(on)
      await $.session.start(SESSION)
      await w.clock.settle()
      const ui = await $.ui.mount({
        plugin: 'agent-history',
        surface,
        component: 'Pane',
        requestId: 'agent-history',
        props: { title: 'agent-history', isFocused: true, bodyColumns: 80, placement: 'dock', scroll: {} as never, view: {} as never },
      })

      // Act
      const hasInit = (await ui.find({ key: 'init' })) !== undefined
      const hasSync = (await ui.find({ key: 'sync' })) !== undefined
      await ui.press({ key: 'init' })
      await w.clock.settle()

      // Assert
      expect(hasInit).toBe(true)
      expect(hasSync).toBe(false)
      expect(w.gitRuns()).toContain('init')
      await ui.unmount()
    })
  }
})
