/** What git can do with the export folder. */
export type AgentHistoryMode = 'unset' | 'export-only' | 'commit' | 'push'

/** The export folder as the last check found it. */
export type AgentHistoryRepo = {
  exportDir: string
  isRepo: boolean
  remote?: string
  branch?: string
}

/** One step of a sync, newest last in the log. */
export type AgentHistoryLogEntry = {
  at: number
  step: 'check' | 'init' | 'export' | 'secret' | 'commit' | 'push'
  isOk: boolean
  message: string
}

/** The secrets found in the exports of this session. */
export type AgentHistorySecrets = {
  count: number
  /** Whether they were redacted, or exported as they are. */
  isRedacted: boolean
  /** Set when the panel was opened after the last new secret; the status line then stops to show it. */
  isSeen: boolean
}

/** What the status line and the panel show. */
export type AgentHistoryStatus = {
  mode: AgentHistoryMode
  repo?: AgentHistoryRepo
  lastExportAt?: number
  lastCommit?: { sha: string; at: number }
  lastPushAt?: number
  /** Sessions exported since the last commit. */
  pending: Array<string>
  /** Set while the last step failed or the repository has no remote; cleared by the next success. */
  warning?: string
  /** Set once an export of this session found a secret. */
  secrets?: AgentHistorySecrets
}

declare module 'claude-code' {
  interface PluginState {
    'agent-history': {
      status: AgentHistoryStatus
      log: Array<AgentHistoryLogEntry>
    }
  }
}
