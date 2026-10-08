export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type RunningAgent = { id: string; name: string; type: string; description: string; parentId?: string; since: number }
export type BackgroundJob = { id: string; taskId?: string; kind: string; label: string; since: number }
export type Task = { id: string; subject: string; status: string; activeForm?: string }
export type Chat = { from: string; to: string; text: string; at: number; kind?: 'spawn' | 'message' }
export type LogLine = { at: number; who: string; to?: string; text: string; color?: string; toColor?: string }
export type FinishedAgent = { id: string; name: string; type: string; description: string; tookMs: number; at: number }

export type Stats = {
  tokens: number
  usd: number
  contextPct: number
  contextTokens: number
  contextWindow: number
  toolCalls: number
  startedAt: number
  now: number
  /** kind -> name -> calls */
  byKind: Record<string, Record<string, number>>
  limits: Limit[]
  agents: RunningAgent[]
  /** when each agent id was first seen */
  seen: Record<string, number>
  /** animation tick when each agent id was first seen */
  seenTick: Record<string, number>
  /** agents that just finished, kept for their exit animation */
  leaving: { id: string; type: string; tick: number }[]
  /** agents that finished recently, with how long they took */
  finished: FinishedAgent[]
  /** the room log: spawns, finishes, messages, background jobs */
  log: LogLine[]
  background: BackgroundJob[]
  tasks: Task[]
  chats: Chat[]
  /** tool calls in flight */
  busy: number
  /** "kind|name" -> calls in flight */
  active: Record<string, number>
  /** "kind|name" -> last time it ran */
  lastUsed: Record<string, number>
  /** short name of the last tool that started */
  current: string
  turnActive: boolean
  lastActivity: number
  happyUntil: number
  /** a tool failed: the pet is puzzled until then */
  puzzledUntil: number
  /** what failed, for the bubble */
  puzzledBy: string
  pets: number
  title: string
  cwd: string
  model: string
  effort: string
  mode: string
  /** permissions.defaultMode from settings, until a turn reports the live mode */
  defaultMode: string
}

declare module 'claude-code' {
  interface PluginState {
    'usage-dashboard': { stats: Stats; frame: number }
  }
}
