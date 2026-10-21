import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import { configOf } from './config'
import type { Config } from './config'
import type { Host } from './host'
import { PADDING, paneView } from './pane-view'
import { createSync } from './sync'
import type { Sync } from './sync'

/** Room kept for the engine's own end step inside the one short bound the end shares. */
const END_MARGIN_MS = 250

const status = atom({ plugin: 'agent-history', key: 'status' } as const, { mode: 'unset', pending: [] })
const log = atom({ plugin: 'agent-history', key: 'log' } as const, [])

const PANE_ID = 'agent-history'
const PANE = { id: PANE_ID, title: 'agent-history', closeOnEscape: true } as const
export const register: Register = (on, options) => {
  const config = configOf(options)
  /** Created at the session's start; a reload runs the start again and replaces it. */
  let sync: Sync | undefined

  on('session.start', async ($, e, next) => {
    sync?.dispose()
    sync = createSync(hostOf($), config)
    await $.command.register({
      name: 'agent-history',
      description: 'Show the session export panel',
    })
    void sync.check()

    return next(e)
  })

  /** The export runs on the sync's queue, so the turn ends without waiting for it. */
  on('classic.Stop', ($, e, next) => {
    void sync?.exportSession({ sessionId: e.session_id, transcriptPath: e.transcript_path, cwd: e.cwd })

    return next(e)
  })

  on('classic.SubagentStop', ($, e, next) => {
    void sync?.exportAgent({
      sessionId: e.session_id,
      agentId: e.agent_id,
      agentType: e.agent_type,
      transcriptPath: e.agent_transcript_path,
    })

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    const timeoutMs = Math.max(1_000, next.budget.remainingMs - END_MARGIN_MS)
    await sync?.end(e.sessionId, timeoutMs)

    return next(e)
  })

  /** Opening the panel reads the folder again, so it shows the repository as it is now, and marks the secrets as seen. */
  on('command.run', { command: 'agent-history' }, async $ => {
    void sync?.check()
    void sync?.seenSecrets()
    await $.ui.open(PANE)

    return { text: 'agent-history panel opened.' }
  })

  /** The view uses elements the terminal and the desktop both have; elsewhere the engine draws its own. */
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, ($, e, next) =>
    e.surface === 'terminal' || e.surface === 'desktop' ? renderPane($, e, config, () => sync) : next(e),
  )
}

/** The engine as the export and git code sees it, bound to the session's `$`. */
function hostOf($: EngineInterface): Host {
  return {
    run: (argv, init) => $.process.run(argv, init),
    runText: async argv => {
      const parts: Array<string> = []
      for await (const chunk of $.process.spawn({ argv })) {
        if (chunk.stream === 'stdout') parts.push(chunk.text)
      }
      return parts.join('')
    },
    read: async path => (await $.fs.read(path)) as string,
    write: (path, text) => $.fs.write(path, text),
    exists: path => $.fs.exists(path),
    size: async path => (await $.fs.stat(path)).size,
    mtime: async path => (await $.fs.stat(path)).mtimeMs,
    home: () => $.env.get('HOME'),
    now: () => $.clock.now(),
    sleep: ms => $.clock.sleep(ms),
    after: (ms, fn) => $.clock.after(ms, fn),
    status: text => $.ui.status(text),
    readStatus: () => read($, status),
    updateStatus: change => update($, status, change),
    updateLog: change => update($, log, change),
  }
}

async function renderPane(
  $: EngineInterface,
  e: RenderInput<'Pane'>,
  config: Config,
  syncOf: () => Sync | undefined,
) {
  const { Box, Text, Button } = $.ui.resolve(e)
  const [value, entries, sessionId] = await Promise.all([read($, status), read($, log), $.session.id()])

  return paneView(
    { Box, Text, Button },
    {
      syncNow: () => void syncOf()?.syncNow(),
      initRepo: () => void syncOf()?.initRepo(),
      close: () => void $.ui.close({ id: PANE_ID }),
    },
    {
      status: value,
      log: entries,
      sessionId,
      config,
      columns: Math.max(e.props.bodyColumns - 2 * PADDING - 1, 20),
      bodyRows: e.props.scroll.bodyRows,
      isDocked: e.props.placement === 'dock',
      surface: e.surface,
    },
  )
}
