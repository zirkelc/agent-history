import type { ElementTable, RenderElement } from 'claude-code'

import type { AgentHistoryLogEntry, AgentHistoryStatus } from '../types'
import type { Config } from './config'
import { clockTime, secretsText } from './sync'
import type { Filters } from './transcript'

/** The elements the pane draws with, on the surfaces that have all of them. */
export type Ui = Pick<ElementTable<'terminal' | 'desktop'>, 'Box' | 'Text' | 'Button'>

/** What a press in the pane does. The view only calls these. */
export type PaneActions = {
  syncNow: () => void
  initRepo: () => void
  close: () => void
}

/** Everything one drawing of the pane reads. */
export type PaneModel = {
  status: AgentHistoryStatus
  log: ReadonlyArray<AgentHistoryLogEntry>
  /** The session the log belongs to; each session has its own log. */
  sessionId: string
  config: Config
  /** The columns inside the pane's padding. */
  columns: number
  /** The rows the pane's body has room for. */
  bodyRows: number
  /** Whether the pane is docked, with rows of its own to fill, rather than inline, where the frame fits the tree. */
  isDocked: boolean
  /** The terminal gets colored buttons of its own, the other surfaces their native ones. */
  surface: string
}

/** The space between the pane's frame and its content, on the left and on the right. */
export const PADDING = 1

/** The background of an action button in the terminal: the blue of a VS Code button, readable in both themes. */
const BUTTON_COLOR = '#0e639c'

/** The mark of a folder kept in git. */
const SYNC_ICON = '⇅'

/** The columns a row's label takes, so the values of every row start in one column. */
const LABEL_WIDTH = 'Content'.length

/** The rows around the log: header and margin, six info rows and the hint, two rules, the log's title, the status line. */
const OUTER_ROWS = 2 + 7 + 2 + 1 + 1

/** The width of the step column in the log. */
const STEP_WIDTH = 'commit'.length

/** The most rows the foot gives a warning; a longer one is cut. */
const WARNING_ROWS = 3

/** The fewest log rows shown, however small the pane. */
const MIN_LOG_ROWS = 3

const FILTER_LABELS: ReadonlyArray<[keyof Filters, string]> = [
  ['text', 'text'],
  ['toolUse', 'tool calls'],
  ['toolInput', 'tool input'],
  ['toolResults', 'tool results'],
  ['thinking', 'thinking'],
  ['meta', 'meta'],
]

const FORMAT_LABELS: Record<Config['formats'][number], string> = { jsonl: 'JSONL', markdown: 'Markdown' }

type ButtonLook = 'primary' | 'neutral'

/** In the terminal a label on a colored ground or as plain text; elsewhere the surface's own button. */
function actionButton(
  ui: Ui,
  model: PaneModel,
  key: string,
  label: string,
  onPress: () => void,
  look: ButtonLook = 'primary',
): RenderElement {
  const { Box, Button } = ui
  if (model.surface !== 'terminal') {
    return (
      <Button key={key} variant={look === 'primary' ? 'primary' : 'secondary'} onPress={onPress}>
        {label}
      </Button>
    )
  }
  return (
    <Box key={`box:${key}`} paddingX={1} {...(look === 'primary' ? { backgroundColor: BUTTON_COLOR } : {})}>
      <Button key={key} plain onPress={onPress}>
        {label}
      </Button>
    </Box>
  )
}

function ruleView(ui: Ui, model: PaneModel, key: string): RenderElement {
  const { Text } = ui
  return (
    <Text key={key} dimColor>
      {'─'.repeat(model.columns)}
    </Text>
  )
}

/** One info row: a dim label padded to the labels' width, then its value. */
function row(ui: Ui, key: string, label: string, value: RenderElement | string): RenderElement {
  const { Box, Text } = ui
  return (
    <Box key={key} flexDirection="row" columnGap={1}>
      <Text dimColor>{label.padEnd(LABEL_WIDTH, ' ')}</Text>
      {typeof value === 'string' ? <Text wrap="truncate">{value}</Text> : value}
    </Box>
  )
}

/** A path cut from the front to a width, so its last parts, which tell it apart, stay. */
export function pathFit(path: string, width: number): string {
  const chars = [...path]
  if (chars.length <= width) return path
  return width <= 1 ? '…' : `…${chars.slice(chars.length - width + 1).join('')}`
}

/** A text cut at the end to a width. */
export function fit(text: string, width: number): string {
  const chars = [...text.replace(/\s+/g, ' ')]
  return chars.length <= width ? chars.join('') : `${chars.slice(0, Math.max(width - 1, 0)).join('')}…`
}

function headerView(ui: Ui, actions: PaneActions, model: PaneModel): RenderElement {
  const { Box, Text } = ui
  const repo = model.status.repo
  return (
    <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
      <Text bold color="cyan">
        AGENT HISTORY
      </Text>
      <Box flexDirection="row" columnGap={2}>
        {repo?.isRepo && actionButton(ui, model, 'sync', `${SYNC_ICON} Sync now`, actions.syncNow)}
        {repo && !repo.isRepo && actionButton(ui, model, 'init', '+ Init git repo', actions.initRepo)}
        {actionButton(ui, model, 'close', '✕ Close', actions.close, 'neutral')}
      </Box>
    </Box>
  )
}

/** What git does with the folder: its remote in green, a missing remote in yellow, no repository dim. */
function gitValue(ui: Ui, model: PaneModel): RenderElement {
  const { Text } = ui
  const { mode, repo } = model.status
  if (!repo) return <Text dimColor>-</Text>
  if (!repo.isRepo) return <Text dimColor>not a repository: export only</Text>
  if (!repo.remote) return <Text color="yellow">{`${SYNC_ICON} ${repo.branch ?? ''}, no remote: commit only`}</Text>
  const target = `${repo.remote}/${repo.branch ?? ''}`
  return mode === 'push' ? (
    <Text color="green">{`${SYNC_ICON} ${target}`}</Text>
  ) : (
    <Text dimColor>{`${SYNC_ICON} ${target}, push off: commit only`}</Text>
  )
}

function infoView(ui: Ui, model: PaneModel): Array<RenderElement> {
  const { Text } = ui
  const { config, status } = model
  const folder = status.repo?.exportDir ?? config.exportDir
  const formats = config.formats.map(format => FORMAT_LABELS[format]).join(' · ') || 'meta only'
  const content = FILTER_LABELS.filter(([key]) => config.filters[key])
    .map(([, label]) => label)
    .join(' · ')
  return [
    row(ui, 'session', 'Session', fit(model.sessionId, model.columns - LABEL_WIDTH - 1)),
    row(
      ui,
      'folder',
      'Folder',
      folder ? pathFit(folder, model.columns - LABEL_WIDTH - 1) : <Text color="yellow">not set: /config</Text>,
    ),
    row(ui, 'git', 'Git', gitValue(ui, model)),
    row(ui, 'formats', 'Formats', formats),
    row(ui, 'content', 'Content', fit(content || 'nothing', model.columns - LABEL_WIDTH - 1)),
    row(
      ui,
      'secrets',
      'Secrets',
      config.redactSecrets ? 'redacted' : <Text color="yellow">kept: exported as they are</Text>,
    ),
    <Text key="hint" dimColor italic wrap="truncate">
      {fit('Change the settings in /config', model.columns)}
    </Text>,
  ]
}

/** One log line, always one row so the rows below never move: the dim time, a green, yellow or red dot, the step, then what it did. */
function logRow(ui: Ui, model: PaneModel, entry: AgentHistoryLogEntry, at: number): RenderElement {
  const { Box, Text } = ui
  const room = model.columns - 5 - 1 - 1 - 1 - STEP_WIDTH - 1
  const color = entry.isOk ? undefined : entry.step === 'secret' ? 'yellow' : 'red'
  return (
    <Box key={`log:${at}`} flexDirection="row" columnGap={1}>
      <Text dimColor>{clockTime(entry.at)}</Text>
      <Text color={color ?? 'green'}>⏺</Text>
      <Text bold={!entry.isOk}>{entry.step.padEnd(STEP_WIDTH, ' ')}</Text>
      <Text dimColor={entry.isOk} color={color} wrap="truncate">
        {fit(entry.message, room)}
      </Text>
    </Box>
  )
}

function logView(ui: Ui, model: PaneModel): Array<RenderElement> {
  const { Text } = ui
  const rows = Math.max(model.bodyRows - OUTER_ROWS - (footRowsOf(model) - 1), MIN_LOG_ROWS)
  const shown = model.log.slice(-rows).reverse()
  const lines =
    shown.length === 0
      ? [
          <Text key="empty" dimColor>
            Nothing exported in this session yet. The next turn exports it.
          </Text>,
        ]
      : shown.map((entry, at) => logRow(ui, model, entry, at))
  /** A docked pane fills its rows, so the status line stays at its foot. */
  const pad = model.isDocked
    ? Array.from({ length: Math.max(rows - lines.length, 0) }, (_, at) => <Text key={`pad:${at}`}> </Text>)
    : []
  return [...lines, ...pad]
}

/** The warning with the message of the step that failed, which says what to fix; else the secrets found. */
function warningText(model: PaneModel): string | undefined {
  const { warning, secrets } = model.status
  if (!warning) return secrets ? `⚠ ${secretsText(secrets)}` : undefined
  const failed = [...model.log].reverse().find(entry => !entry.isOk)
  const detail = failed && warning.startsWith(failed.step) ? `: ${failed.message}` : ''
  return `⚠ ${warning}${detail}`
}

/** A text cut into rows of a width, at most `count` of them, the last ending in `…` when more is left. */
export function rowsOf(text: string, width: number, count: number): Array<string> {
  const chars = [...text.replace(/\s+/g, ' ')]
  const rows: Array<string> = []
  for (let at = 0; at < chars.length && rows.length < count; at += width) rows.push(chars.slice(at, at + width).join(''))
  if (chars.length > width * count) rows[count - 1] = [...(rows[count - 1] ?? '')].slice(0, width - 1).join('') + '…'
  return rows
}

/** The foot's rows: as many as the warning needs, up to a few; the log gives up the same rows. */
function footRowsOf(model: PaneModel): number {
  const warning = warningText(model)
  return warning ? Math.max(rowsOf(warning, model.columns, WARNING_ROWS).length, 1) : 1
}

/** The foot: the warning or the secrets in full while one stands, else when each step last ran and what waits for the next commit, its mark at the end of the rule above. */
function statusView(ui: Ui, model: PaneModel): RenderElement {
  const { Box, Text } = ui
  const { status } = model
  const warning = warningText(model)
  if (warning) {
    const isMild = !status.warning || status.warning === 'no remote' || status.mode === 'unset'
    const color = isMild ? 'yellow' : 'red'
    const rows = rowsOf(warning, model.columns, WARNING_ROWS)
    return (
      <Box key="status" flexDirection="column">
        {rows.map((text, at) => (
          <Text key={`warning:${at}`} color={color} wrap="truncate">
            {text}
          </Text>
        ))}
      </Box>
    )
  }
  const time = (ms: number | undefined) => (ms === undefined ? '-' : clockTime(ms))
  const parts = [
    `export ${time(status.lastExportAt)}`,
    ...(status.repo?.isRepo ? [`commit ${status.lastCommit ? `${status.lastCommit.sha} ${clockTime(status.lastCommit.at)}` : '-'}`] : []),
    ...(status.mode === 'push' ? [`push ${time(status.lastPushAt)}`] : []),
    ...(status.pending.length > 0 ? [`${status.pending.length} pending`] : []),
  ]
  return (
    <Box key="status" flexDirection="row" justifyContent="space-between" width={model.columns}>
      <Text dimColor wrap="truncate">
        {fit(parts.join(' · '), model.columns - 2)}
      </Text>
      <Text color="green">✓</Text>
    </Box>
  )
}

/** The whole pane: the header and its actions, what the export does, the activity log, the status line. */
export function paneView(ui: Ui, actions: PaneActions, model: PaneModel): RenderElement {
  const { Box, Text } = ui
  return (
    <Box flexDirection="column" paddingX={PADDING}>
      {headerView(ui, actions, model)}
      {infoView(ui, model)}
      {ruleView(ui, model, 'rule:log')}
      <Text bold>Activity in this session</Text>
      {logView(ui, model)}
      {ruleView(ui, model, 'rule:status')}
      {statusView(ui, model)}
    </Box>
  )
}
