export type TodoStatus = 'pending' | 'in_progress' | 'completed'

/** `depth` is how deep a task sits under others in an ODD document, 0 on top. */
export type TodoItem = { id: string; text: string; status: TodoStatus; depth?: number }

export type TodoGroup = {
  id: string
  label: string
  kind: 'agent' | 'tasks' | 'odd'
  items: TodoItem[]
  updatedAt: number
}

/** A group sent to the archive: a snapshot, kept across sessions per project. */
export type ArchivedGroup = TodoGroup & { sourceId: string; archivedAt: number }

export type BandMode = 'auto' | 'on' | 'off'

export type TodoTab = 'all' | 'agents' | 'odd' | 'tasks' | 'archived'

declare module 'claude-code' {
  interface PluginState {
    'agent-todos': { groups: TodoGroup[]; bandMode: BandMode; tab: TodoTab; archive: ArchivedGroup[]; collapsed: Record<string, boolean> }
  }
}
