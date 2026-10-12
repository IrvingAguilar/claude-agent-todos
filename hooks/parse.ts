import type { ArchivedGroup, TodoGroup, TodoItem, TodoStatus, TodoTab } from '../types'

export const ODD_PATH = /(?:^|[\\/])odd[\\/]tasks[\\/]([^\\/]+)\.md$/

/** The feature name of an ODD feature document path, or undefined. */
export function oddFeature(path: string): string | undefined {
  return ODD_PATH.exec(path)?.[1]
}

const DONE = /\b(done|completed?|closed|merged|green)\b|✅|✔|✓|☑/i
const ACTIVE = /\b(in[ _-]?progress|wip|doing|running|active)\b|🔄|⏳|▶/i

function statusOf(text: string): TodoStatus {
  if (DONE.test(text)) return 'completed'
  if (ACTIVE.test(text)) return 'in_progress'
  return 'pending'
}

function tasksSection(doc: string): string[] {
  const lines = doc.split(/\r?\n/)
  const start = lines.findIndex(line => /^##\s+Tasks\b/i.test(line))
  if (start === -1) return []
  const rest = lines.slice(start + 1)
  const end = rest.findIndex(line => /^##\s/.test(line))

  return end === -1 ? rest : rest.slice(0, end)
}

const CHECKBOX = /^(\s*)[-*+]\s+\[([ xX~\-/])\]\s+(.+)$/

/** Columns of leading whitespace, a tab standing for one indent unit. */
function indentOf(whitespace: string, tabWidth: number): number {
  let columns = 0
  for (const char of whitespace) columns += char === '\t' ? tabWidth : 1

  return columns
}

/** The lines of the section outside fenced code blocks. */
function proseLines(lines: readonly string[]): string[] {
  let isFenced = false

  return lines.filter(line => {
    if (/^\s*(```|~~~)/.test(line)) {
      isFenced = !isFenced
      return false
    }
    return !isFenced
  })
}

function cleanText(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1').trim()
}

/**
 * Reads the `## Tasks` section of an ODD feature document.
 *
 * A task is a checkbox line (`- [ ]`, `- [x]`, `- [~]`); everything else in
 * the section (a task's notes, its tables, its plain bullets) is its body and
 * no task. Nesting follows indentation, tabs or spaces: a checkbox indented
 * under another is its subtask. A section with no checkbox at all falls back
 * to top-level table rows and `T1 ...` bullets, unindented only.
 */
export function parseOddTasks(doc: string): TodoItem[] {
  const lines = proseLines(tasksSection(doc))
  const boxes = lines.flatMap(line => {
    const match = CHECKBOX.exec(line)
    return match ? [{ indent: indentOf(match[1] ?? '', 2), mark: match[2] ?? ' ', text: cleanText(match[3] ?? '') }] : []
  })

  return boxes.length > 0 ? checkboxTasks(boxes) : flatTasks(lines)
}

function checkboxTasks(boxes: { indent: number; mark: string; text: string }[]): TodoItem[] {
  const items: TodoItem[] = []
  const parents: number[] = []
  const seen = new Set<string>()
  for (const box of boxes) {
    while (parents.length > 0 && (parents.at(-1) ?? 0) >= box.indent) parents.pop()
    const depth = parents.length
    parents.push(box.indent)
    const status: TodoStatus = box.mark === 'x' || box.mark === 'X' ? 'completed' : box.mark === ' ' ? 'pending' : 'in_progress'
    items.push({ id: uniqueId(idOf(box.text, items.length), seen), text: box.text, status, depth })
  }

  return items
}

function flatTasks(lines: readonly string[]): TodoItem[] {
  const items: TodoItem[] = []
  const seen = new Set<string>()
  for (const raw of lines) {
    if (/^\s/.test(raw) || raw.trim() === '') continue
    const line = raw.trim()
    if (line.startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map(cell => cell.trim())
      const isSeparator = cells.every(cell => /^:?-{2,}:?$/.test(cell) || cell === '')
      const isHeader = /^(id|task|tarea)$/i.test(cells[0] ?? '')
      if (isSeparator || isHeader || cells.length === 0) continue
      const text = cleanText(cells.filter(cell => cell !== '').join(' · '))
      items.push({ id: uniqueId(idOf(cells[0] ?? '', items.length), seen), text, status: statusOf(cells.slice(1).join(' ')), depth: 0 })
      continue
    }
    const bullet = /^(?:[-*+]\s+)?(\**T[A-Z]?-?\d+[a-z]?\b.*)$/.exec(line)
    if (bullet) {
      const text = cleanText(bullet[1] ?? '')
      items.push({ id: uniqueId(idOf(text, items.length), seen), text, status: statusOf(text.replace(TASK_ID, '')), depth: 0 })
    }
  }

  return items
}

const TASK_ID = /^\**(T[A-Z]?-?\d+[a-z]?)\b/

function idOf(text: string, index: number): string {
  return TASK_ID.exec(text)?.[1] ?? `#${index + 1}`
}

function uniqueId(id: string, seen: Set<string>): string {
  let unique = id
  for (let n = 2; seen.has(unique); n += 1) unique = `${id}~${n}`
  seen.add(unique)

  return unique
}

/**
 * Replaces the group with the same id where it stands (no reordering, so the
 * drawing does not jump), or adds a new one first.
 */
export function upsertGroup(groups: TodoGroup[], group: TodoGroup): TodoGroup[] {
  const isEmpty = group.items.length === 0 && group.kind !== 'odd'
  const at = groups.findIndex(one => one.id === group.id)
  if (at === -1) return isEmpty ? groups : [group, ...groups].slice(0, 30)
  if (isEmpty) return groups.filter(one => one.id !== group.id)

  return groups.map(one => (one.id === group.id ? group : one))
}

/** Whether two lists draw the same, `updatedAt` aside. */
export function sameGroups(a: TodoGroup[], b: TodoGroup[]): boolean {
  const shape = (list: TodoGroup[]) =>
    JSON.stringify(list.map(({ id, label, kind, items }) => ({ id, label, kind, items })))

  return shape(a) === shape(b)
}

export function counts(items: TodoItem[]): { done: number; total: number } {
  return { done: items.filter(item => item.status === 'completed').length, total: items.length }
}

export const ICON: Record<TodoStatus, string> = {
  completed: '✔',
  in_progress: '◐',
  pending: '○',
}

export type TokenKind = 'id' | 'spec' | 'commit' | 'route' | 'path' | 'plain'

export type Token = { text: string; kind: TokenKind }

const TOKEN = /\b(T[A-Z]?-?\d+[a-z]?)\b|\b(S\d+(?:\s*[-–]\s*S?\d+)?)\b|\b([0-9a-f]{7,40})\b|\b([Ii]nline|[Dd]elegated|[Dd]elegada?)\b|(`[^`]+`)/g

/** Splits a task's text into runs the drawing colors apart. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  let last = 0
  for (const match of text.matchAll(TOKEN)) {
    const at = match.index ?? 0
    if (at > last) tokens.push({ text: text.slice(last, at), kind: 'plain' })
    const kind: TokenKind = match[1] ? 'id' : match[2] ? 'spec' : match[3] ? 'commit' : match[4] ? 'route' : 'path'
    tokens.push({ text: match[0], kind })
    last = at + match[0].length
  }
  if (last < text.length) tokens.push({ text: text.slice(last), kind: 'plain' })

  return tokens
}

const BLOCKED = /\b(blocked|bloquead[ao]|failed|fall[oó]|error)\b|❌/i

export function isBlocked(text: string): boolean {
  return BLOCKED.test(text)
}

/** A stable index for a group id, to pick its accent from the theme. */
export function hashIndex(id: string, size: number): number {
  let hash = 0
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0

  return hash % size
}

export const TABS: { tab: TodoTab; label: string }[] = [
  { tab: 'all', label: 'All' },
  { tab: 'agents', label: 'Agents' },
  { tab: 'odd', label: 'ODD' },
  { tab: 'tasks', label: 'Tasks' },
  { tab: 'archived', label: 'Archived' },
]

const ARCHIVE_LIMIT = 200

/**
 * The groups a tab shows. An archived ODD feature stays hidden from the live
 * tabs and shows its document's current tasks under `archived`; any other
 * archived group shows the snapshot taken when it was archived.
 */
export function groupsForTab(list: TodoGroup[], tab: TodoTab, archive: readonly ArchivedGroup[]): TodoGroup[] {
  if (tab === 'archived') {
    return archive.map(snapshot => {
      const live = snapshot.kind === 'odd' ? list.find(group => group.id === snapshot.sourceId) : undefined

      return live ? { ...snapshot, items: live.items } : snapshot
    })
  }
  const hidden = new Set(archive.filter(one => one.kind === 'odd').map(one => one.sourceId))
  const live = list.filter(group => !hidden.has(group.id))
  if (tab === 'agents') return live.filter(group => group.kind === 'agent')
  if (tab === 'odd') return live.filter(group => group.kind === 'odd')
  if (tab === 'tasks') return live.filter(group => group.kind === 'tasks')

  return live
}

/**
 * Archives a group: a snapshot, newest first, under an id of its own so a
 * later list of the same agent is a new live group. An ODD feature is archived
 * once, by its feature.
 */
export function archiveGroup(archive: ArchivedGroup[], group: TodoGroup, now: number): ArchivedGroup[] {
  const isOdd = group.kind === 'odd'
  if (isOdd && archive.some(one => one.sourceId === group.id)) return archive
  const snapshot: ArchivedGroup = {
    ...group,
    id: isOdd ? group.id : `${group.id}@${now}`,
    sourceId: group.id,
    archivedAt: now,
  }

  return [snapshot, ...archive].slice(0, ARCHIVE_LIMIT)
}

/** The live list once a snapshot is restored: ODD comes back by itself. */
export function restoreGroup(list: TodoGroup[], snapshot: ArchivedGroup): TodoGroup[] {
  if (snapshot.kind === 'odd') return list
  const { sourceId, archivedAt: _at, ...group } = snapshot
  const id = list.some(one => one.id === sourceId) ? snapshot.id : sourceId

  return [{ ...group, id }, ...list.filter(one => one.id !== id)]
}

/** Reads what the store held back into an archive, dropping what is not one. */
export function readArchive(value: unknown): ArchivedGroup[] {
  if (!Array.isArray(value)) return []

  return value.filter(
    (one): one is ArchivedGroup =>
      typeof one === 'object' && one !== null && typeof one.id === 'string' &&
      typeof one.sourceId === 'string' && Array.isArray(one.items),
  )
}

/**
 * Whether a group's tasks are folded away: what the person chose for it, or
 * by default folded once every task is done.
 */
export function isCollapsed(group: TodoGroup, chosen: Readonly<Record<string, boolean>>): boolean {
  const choice = chosen[group.id]
  if (choice !== undefined) return choice
  const { done, total } = counts(group.items)

  return total > 0 && done === total
}

/** A tool use as the transcript keeps it: the parts a reload reads. */
export type TranscriptToolUse = { tool: string; input: Record<string, unknown>; result?: unknown; agentId?: string }

/** The items of the last TodoWrite among these tool uses, or undefined. */
export function lastTodos(uses: readonly TranscriptToolUse[]): TodoItem[] | undefined {
  const last = [...uses].reverse().find(use => use.tool === 'TodoWrite')
  if (last === undefined) return undefined
  const todos = Array.isArray(last.input.todos) ? last.input.todos : []

  return todos.flatMap((todo: unknown, index: number): TodoItem[] => {
    if (typeof todo !== 'object' || todo === null) return []
    const { content, status, activeForm } = todo as { content?: unknown; status?: unknown; activeForm?: unknown }
    if (typeof content !== 'string' || (status !== 'pending' && status !== 'in_progress' && status !== 'completed')) return []
    const text = status === 'in_progress' && typeof activeForm === 'string' && activeForm !== '' ? activeForm : content

    return [{ id: String(index), text, status }]
  })
}

/** The session's tasks from what TaskList answered, deleted ones gone. */
export function taskListItems(result: unknown): TodoItem[] {
  const tasks = (result as { tasks?: unknown } | undefined)?.tasks
  if (!Array.isArray(tasks)) return []

  return tasks.flatMap((task: unknown): TodoItem[] => {
    const { id, subject, status } = (task ?? {}) as { id?: unknown; subject?: unknown; status?: unknown }
    if (typeof id !== 'string' || typeof subject !== 'string') return []
    if (status !== 'pending' && status !== 'in_progress' && status !== 'completed') return []

    return [{ id, text: subject, status }]
  })
}

/**
 * A reloaded list: the groups found now, each where it stood before when it
 * was there, new ones after them; groups no longer found are dropped.
 */
export function mergeReloaded(before: readonly TodoGroup[], found: readonly TodoGroup[]): TodoGroup[] {
  const byId = new Map(found.map(group => [group.id, group]))
  const kept = before.flatMap(group => {
    const now = byId.get(group.id)
    return now ? [now] : []
  })
  const added = found.filter(group => !before.some(one => one.id === group.id))

  return [...kept, ...added].filter(group => group.items.length > 0 || group.kind === 'odd')
}
