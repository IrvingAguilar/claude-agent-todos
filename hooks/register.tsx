import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderInput } from 'claude-code'

import type { ArchivedGroup, TodoGroup, TodoItem, TodoStatus, TodoTab } from '../types'
import { ICON, TABS, lastTodos, mergeReloaded, taskListItems, archiveGroup, counts, isCollapsed, groupsForTab, readArchive, restoreGroup, hashIndex, sameGroups, isBlocked, oddFeature, parseOddTasks, tokenize, upsertGroup } from './parse'
import type { TokenKind, TranscriptToolUse } from './parse'
import { DEPTH_COLUMNS, ICON_COLUMNS, layoutRows, tabsHeight, wheelOffset, windowRows } from './layout'
import type { Row } from './layout'

const PANE = 'agent-todos'
const TITLE = 'Todos'
const groups = atom({ plugin: 'agent-todos', key: 'groups' } as const, [])
const bandMode = atom({ plugin: 'agent-todos', key: 'bandMode' } as const, 'auto')
const activeTab = atom({ plugin: 'agent-todos', key: 'tab' } as const, 'all')
const archive = atom({ plugin: 'agent-todos', key: 'archive' } as const, [])
const collapsed = atom({ plugin: 'agent-todos', key: 'collapsed' } as const, {})


// Every color is a theme key, so the drawing follows the person's theme.
const STATUS_COLOR: Record<TodoStatus, string> = {
  completed: 'success',
  in_progress: 'warning',
  pending: 'inactive',
}

const STATUS_TEXT: Record<TodoStatus, string> = {
  completed: 'subtle',
  in_progress: 'text',
  pending: 'text',
}

const TOKEN_COLOR: Record<TokenKind, string | undefined> = {
  id: 'suggestion',
  spec: 'remember',
  commit: 'merged',
  route: 'planMode',
  path: 'ide',
  plain: undefined,
}

const AGENT_ACCENTS = ['suggestion', 'autoAccept', 'permission', 'planMode', 'remember', 'merged', 'ide', 'bashBorder', 'promptBorder']

function accentOf(group: TodoGroup): string {
  if (group.kind === 'odd') return 'claude'
  if (group.kind === 'tasks') return 'permission'
  if (group.id === 'agent:main') return 'suggestion'

  return AGENT_ACCENTS[hashIndex(group.id, AGENT_ACCENTS.length)] ?? 'suggestion'
}

const KIND_ICON: Record<TodoGroup['kind'], string> = { odd: '◆', tasks: '■', agent: '●' }

const oddFiles = new Map<string, string>()

async function agentLabel($: EngineInterface, agentId: string | undefined): Promise<string> {
  if (agentId === undefined) return 'Main agent'
  const agent = (await $.agent.list()).find(one => one.id === agentId)

  return agent ? `${agent.type}: ${agent.description}` : `Agent ${agentId.slice(0, 8)}`
}

async function loadOdd($: EngineInterface, path: string): Promise<void> {
  const feature = oddFeature(path)
  if (feature === undefined) return
  oddFiles.set(feature, path)
  const text = await $.fs.read(path).catch(() => undefined)
  if (typeof text !== 'string') return
  const group: TodoGroup = {
    id: `odd:${feature}`,
    label: `ODD · ${feature}`,
    kind: 'odd',
    items: parseOddTasks(text),
    updatedAt: Date.now(),
  }
  await setGroups($, list => upsertGroup(list, group))
}

/**
 * Writes the list only when what it draws changed: every write redraws the
 * pane and the band, so an unchanged list is never written.
 */
async function setGroups($: EngineInterface, change: (list: TodoGroup[]) => TodoGroup[]): Promise<void> {
  const current = await read($, groups)
  const next = change(current)
  if (sameGroups(current, next)) return
  await update($, groups, () => next)
}

/** The store key of this project's archive: it outlives the session. */
async function archiveKey($: EngineInterface): Promise<string> {
  return `archive:${await $.session.cwd()}`
}

async function loadArchive($: EngineInterface): Promise<void> {
  const stored = readArchive(await $.store.get(await archiveKey($)))
  await update($, archive, () => stored)
}

/**
 * Writes the archive to the session's state and to the store, together. The
 * change starts from the store, so it never drops what an earlier session kept.
 */
async function saveArchive($: EngineInterface, change: (list: ArchivedGroup[]) => ArchivedGroup[]): Promise<void> {
  const key = await archiveKey($)
  const next = change(readArchive(await $.store.get(key)))
  await update($, archive, () => next)
  await $.store.set(key, next)
}

async function archiveOne($: EngineInterface, group: TodoGroup): Promise<void> {
  await saveArchive($, list => archiveGroup(list, group, Date.now()))
  if (group.kind !== 'odd') await setGroups($, list => list.filter(one => one.id !== group.id))
}

async function restoreOne($: EngineInterface, snapshot: ArchivedGroup): Promise<void> {
  await saveArchive($, list => list.filter(one => one.id !== snapshot.id))
  await setGroups($, list => restoreGroup(list, snapshot))
}

async function deleteOne($: EngineInterface, snapshot: ArchivedGroup): Promise<void> {
  await saveArchive($, list => list.filter(one => one.id !== snapshot.id))
}

function TabBar($: EngineInterface, e: RenderInput<'Pane'>, model: PaneModel) {
  const { Box, Button } = $.ui.resolve(e)

  return (
    <Box flexDirection="row" flexWrap="wrap" marginBottom={1}>
      {TABS.map((one, index) => {
        const isActive = one.tab === model.tab
        const isEmpty = (model.tabLabels[index] ?? '').endsWith(' 0')

        return (
          <Button
            key={`tab:${one.tab}`}
            label={model.tabLabels[index] ?? one.label}
            hotkey={String(index + 1)}
            variant={isActive ? 'primary' : 'secondary'}
            dimColor={!isActive && isEmpty}
            onPress={() => update($, activeTab, () => one.tab)}
          />
        )
      })}
    </Box>
  )
}

/** Reads one ODD feature document into a group; undefined once it is gone. */
async function readOdd($: EngineInterface, path: string): Promise<TodoGroup | undefined> {
  const feature = oddFeature(path)
  if (feature === undefined) return undefined
  const text = await $.fs.read(path).catch(() => undefined)
  if (typeof text !== 'string') return undefined

  return { id: `odd:${feature}`, label: `ODD · ${feature}`, kind: 'odd', items: parseOddTasks(text), updatedAt: Date.now() }
}

async function transcriptUses($: EngineInterface, agentId?: string): Promise<TranscriptToolUse[]> {
  const found = agentId === undefined ? await $.session.messages() : await $.session.messages({ agentId })
  if (!Array.isArray(found)) return []

  return found.flatMap(message => message.toolUses)
}

/**
 * Rebuilds the list from the sources themselves: each agent's last TodoWrite
 * in its transcript, the session's tasks as TaskList answers them, every ODD
 * document under odd/tasks, and the archive in the store.
 */
async function reloadAll($: EngineInterface): Promise<string> {
  const found: TodoGroup[] = []
  const mainUses = await transcriptUses($)
  const mainTodos = lastTodos(mainUses)
  if (mainTodos) found.push({ id: 'agent:main', label: 'Main agent', kind: 'agent', items: mainTodos, updatedAt: Date.now() })

  const agentIds = new Set<string>()
  for (const use of mainUses) if (use.agentId) agentIds.add(use.agentId)
  for (const agent of await $.agent.list()) agentIds.add(agent.id)
  for (const agentId of agentIds) {
    const todos = lastTodos(await transcriptUses($, agentId))
    if (todos) found.push({ id: `agent:${agentId}`, label: await agentLabel($, agentId), kind: 'agent', items: todos, updatedAt: Date.now() })
  }

  const listed = await $.tool.call({ tool: 'TaskList' }).catch(() => undefined)
  const tasks = taskListItems(listed && 'result' in listed ? listed.result : undefined)
  if (tasks.length > 0) found.push({ id: 'tasks', label: 'Session tasks', kind: 'tasks', items: tasks, updatedAt: Date.now() })

  oddFiles.clear()
  const entries = await $.fs.list('odd/tasks').catch(() => [])
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue
    const path = `odd/tasks/${entry.name}`
    const group = await readOdd($, path)
    if (group) {
      oddFiles.set(group.id.slice('odd:'.length), path)
      found.push(group)
    }
  }

  await loadArchive($)
  await setGroups($, list => mergeReloaded(list, found))
  const odd = found.filter(group => group.kind === 'odd').length

  return `Todos reloaded: ${found.length - odd} agent and task groups, ${odd} ODD features.`
}

async function scanOdd($: EngineInterface): Promise<void> {
  const entries = await $.fs.list('odd/tasks').catch(() => [])
  for (const entry of entries) {
    if (entry.kind === 'file' && entry.name.endsWith('.md')) {
      await loadOdd($, `odd/tasks/${entry.name}`)
    }
  }
  for (const path of oddFiles.values()) await loadOdd($, path)
}

function barWidthFor(columns: number): number {
  return Math.max(4, Math.min(12, columns - 30))
}

function ItemText($: EngineInterface, e: RenderInput<'Pane' | 'AbovePrompt'>, item: TodoItem) {
  const { Box, Text } = $.ui.resolve(e)
  const blocked = item.status !== 'completed' && isBlocked(item.text)
  const isActive = item.status === 'in_progress'

  return (
    <Box flexDirection="row" marginLeft={DEPTH_COLUMNS * (item.depth ?? 0)}>
      <Box width={ICON_COLUMNS} flexShrink={0}>
        <Text color={blocked ? 'error' : STATUS_COLOR[item.status]}>{blocked ? '✖' : ICON[item.status]}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text
          wrap="wrap"
          color={blocked ? 'diffRemoved' : STATUS_TEXT[item.status]}
          strikethrough={item.status === 'completed'}
          bold={isActive}
          backgroundColor={isActive ? 'diffAddedDimmed' : undefined}
        >
          {tokenize(item.text).map(token => {
            const color = item.status === 'completed' ? undefined : TOKEN_COLOR[token.kind]

            return color === undefined ? token.text : <Text color={color}>{token.text}</Text>
          })}
        </Text>
      </Box>
    </Box>
  )
}

function GroupTitle($: EngineInterface, e: RenderInput<'Pane' | 'AbovePrompt'>, group: TodoGroup) {
  const { Box, Text } = $.ui.resolve(e)
  const { done, total } = counts(group.items)
  const isDone = total > 0 && done === total
  const hasBlocked = group.items.some(item => item.status !== 'completed' && isBlocked(item.text))
  const accent = accentOf(group)

  return [
    <Box key="icon" flexShrink={0}>
      <Text color={accent}>{KIND_ICON[group.kind]} </Text>
    </Box>,
    <Box key="label" flexGrow={1} flexShrink={1}>
      <Text bold color={accent} wrap="truncate-end">{group.label}</Text>
    </Box>,
    <Box key="count" flexShrink={0} marginLeft={1}>
      <Text color="inverseText" backgroundColor={isDone ? 'success' : hasBlocked ? 'error' : 'warning'}> {done}/{total} </Text>
    </Box>,
  ]
}

/** One row of the pane's flat layout (layout.ts), drawn at its height. */
function RowView($: EngineInterface, e: RenderInput<'Pane'>, row: Row, archived: readonly ArchivedGroup[] | undefined) {
  const { Box, Button, Text } = $.ui.resolve(e)

  if (row.kind === 'gap') return <Box key={row.key} height={row.height} />
  if (row.kind === 'empty') {
    return <Text key={row.key} color="inactive" italic>{archived ? 'Nothing archived.' : 'No agent tasks yet.'}</Text>
  }
  if (row.kind === 'item') return <Box key={row.key}>{ItemText($, e, row.item)}</Box>
  if (row.kind === 'bar') {
    const { done, total } = counts(row.group.items)
    const width = barWidthFor(e.props.bodyColumns)
    const filled = Math.round((done / total) * width)
    const isDone = done === total
    const hasBlocked = row.group.items.some(item => item.status !== 'completed' && isBlocked(item.text))

    return (
      <Box key={row.key} flexDirection="row">
        <Text color={isDone ? 'diffAdded' : 'diffAddedWord'}>{'━'.repeat(filled)}</Text>
        <Text color={hasBlocked ? 'diffRemovedWord' : 'diffRemovedDimmed'}>{'━'.repeat(width - filled)}</Text>
      </Box>
    )
  }

  const group = row.group
  const snapshot = archived?.find(one => one.id === group.id)

  return (
    <Box key={row.key} flexDirection="row">
      <Box flexShrink={0} marginRight={1}>
        <Button
          key={`toggle:${group.id}`}
          label={row.isFolded ? '▸' : '▾'}
          plain
          onPress={() => update($, collapsed, chosen => ({ ...chosen, [group.id]: !row.isFolded }))}
        />
      </Box>
      {GroupTitle($, e, group)}
      {archived === undefined && (
        <Box flexShrink={0} marginLeft={1}>
          <Button key={`archive:${group.id}`} label="Archive" dimColor onPress={() => archiveOne($, group)} />
        </Box>
      )}
      {snapshot !== undefined && (
        <Box flexShrink={0} marginLeft={1} flexDirection="row">
          <Button key={`restore:${group.id}`} label="Restore" onPress={() => restoreOne($, snapshot)} />
          {group.kind !== 'odd' && (
            <Button key={`delete:${group.id}`} label="Delete" dimColor onPress={() => deleteOne($, snapshot)} />
          )}
        </Box>
      )}
    </Box>
  )
}

/** The groups with a task in progress, each with only those tasks. */
function inProgress(list: TodoGroup[]): TodoGroup[] {
  return list
    .map(group => ({ ...group, items: group.items.filter(item => item.status === 'in_progress') }))
    .filter(group => group.items.length > 0)
}

/** The band: what the agents are doing right now, one title per group. */
function BandTree($: EngineInterface, e: RenderInput<'AbovePrompt'>, list: TodoGroup[]) {
  const { Box } = $.ui.resolve(e)

  return (
    <Box flexDirection="column">
      {list.map(group => (
        <Box key={group.id} flexDirection="column">
          <Box flexDirection="row">{GroupTitle($, e, group)}</Box>
          {group.items.map(item => <Box key={`${group.id}:${item.id}`}>{ItemText($, e, item)}</Box>)}
        </Box>
      ))}
    </Box>
  )
}

/** What the pane draws from, computed once per change of state or width. */
type PaneModel = {
  list: TodoGroup[]
  tab: TodoTab
  archived: ArchivedGroup[]
  tabLabels: string[]
  rows: Row[]
}

let paneCache: { key: string; model: PaneModel } | undefined

async function paneModel($: EngineInterface, columns: number): Promise<PaneModel> {
  const [groupsRead, tabRead, archiveRead, collapsedRead] = await Promise.all([
    $.state.get({ plugin: 'agent-todos', key: 'groups' }),
    $.state.get({ plugin: 'agent-todos', key: 'tab' }),
    $.state.get({ plugin: 'agent-todos', key: 'archive' }),
    $.state.get({ plugin: 'agent-todos', key: 'collapsed' }),
  ])
  const key = [groupsRead.version, tabRead.version, archiveRead.version, collapsedRead.version, columns].join(':')
  if (paneCache?.key === key) return paneCache.model

  const list = groupsRead.value ?? []
  const tab = tabRead.value ?? 'all'
  const archived = archiveRead.value ?? []
  const shown = groupsForTab(list, tab, archived)
  const model: PaneModel = {
    list,
    tab,
    archived,
    tabLabels: TABS.map(one => `${one.label} ${groupsForTab(list, one.tab, archived).length}`),
    rows: layoutRows(shown, collapsedRead.value ?? {}, columns, tab === 'archived' ? 'Nothing archived.' : 'No agent tasks yet.'),
  }
  paneCache = { key, model }

  return model
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'todos',
      description: 'Agent todos: open the pane; "reload" re-reads every source; "band on|off|auto" shows or hides the in-progress band above the prompt; "clear" empties it',
    })
    await loadArchive($)
    await scanOdd($)
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'todos' }, async ($, e) => {
    const words = String(e.args ?? '').trim().split(/\s+/)
    if (words[0] === 'band' && (words[1] === 'on' || words[1] === 'off' || words[1] === 'auto')) {
      const mode = words[1]
      await update($, bandMode, () => mode)

      return { text: `Todos band: ${mode}.` }
    }
    if (words[0] === 'reload') {
      return { text: await reloadAll($) }
    }
    if (words[0] === 'clear') {
      await update($, groups, () => [])

      return { text: 'Todos cleared.' }
    }
    await scanOdd($)
    const opened = await $.ui.open({ id: PANE, title: TITLE })

    return { text: opened.isPlaced ? 'Todos pane opened.' : 'Todos pane waits for a wider terminal; the band above the prompt shows them.' }
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    const todos = (e as { todos?: { content: string; status: TodoStatus; activeForm?: string }[] }).todos ?? []
    const items: TodoItem[] = todos.map((todo, index) => ({
      id: String(index),
      text: todo.status === 'in_progress' && todo.activeForm ? todo.activeForm : todo.content,
      status: todo.status,
    }))
    const group: TodoGroup = {
      id: `agent:${e.agentId ?? 'main'}`,
      label: await agentLabel($, e.agentId),
      kind: 'agent',
      items,
      updatedAt: Date.now(),
    }
    await setGroups($, list => upsertGroup(list, group))

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    const id = (ran as { result?: { task?: { id?: string } } }).result?.task?.id
    const subject = String((e as { subject?: unknown }).subject ?? '')
    if (id === undefined) return ran
    await setGroups($, list => {
      const current = list.find(one => one.id === 'tasks')
      const items = [...(current?.items ?? []), { id, text: subject, status: 'pending' as const }]

      return upsertGroup(list, { id: 'tasks', label: 'Session tasks', kind: 'tasks', items, updatedAt: Date.now() })
    })

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    const args = e as { taskId?: string; status?: TodoStatus | 'deleted'; subject?: string; activeForm?: string }
    await setGroups($, list => {
      const current = list.find(one => one.id === 'tasks')
      if (current === undefined) return list
      const items = current.items
        .filter(item => !(item.id === args.taskId && args.status === 'deleted'))
        .map(item =>
          item.id === args.taskId
            ? {
                ...item,
                text: args.subject ?? item.text,
                status: args.status === undefined || args.status === 'deleted' ? item.status : args.status,
              }
            : item,
        )

      return upsertGroup(list, { ...current, items, updatedAt: Date.now() })
    })

    return ran
  }).catch(($, e, next) => next(e))

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    const path = (e as { file_path?: unknown }).file_path
    if (typeof path === 'string' && oddFeature(path) !== undefined) {
      await loadOdd($, path)
    }

    return ran
  }).catch(($, e, next) => next(e))

  // Catches ODD documents an agent changed without Write or Edit (a shell
  // command, a subagent's turn); a no-op unless their tasks changed.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    await scanOdd($)

    return done
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box } = $.ui.resolve(e)
    const columns = e.props.bodyColumns
    const model = await paneModel($, columns)
    const { offset, bodyRows } = e.props.scroll
    const top = tabsHeight(model.tabLabels, columns)
    // Rows far from the window are stood in for by empty boxes of their
    // height, so a scroll step draws a short tree of the same total height.
    const window = windowRows(model.rows, top, offset, bodyRows, bodyRows)
    const archived = model.tab === 'archived' ? model.archived : undefined

    return (
      <Box flexDirection="column">
        {TabBar($, e, model)}
        {window.before > 0 && <Box key="before" height={window.before} />}
        {window.rows.map(row => RowView($, e, row, archived))}
        {window.after > 0 && <Box key="after" height={window.after} />}
      </Box>
    )
  }).catch(($, e, next) => next(e))

  // A wheel tick moves the pane WHEEL_STEP rows instead of one: a third of
  // the redraws for the same distance. Keys keep their own steps.
  on('ui.scroll', { component: 'Pane', requestId: PANE }, ($, e, next) => {
    const isWheel = e.origin?.kind === 'person' && e.pointer !== undefined

    return next({ ...e, offset: wheelOffset({ ...e, isWheel }) })
  })

  // The band shows the tasks in progress, whatever the width: it stays a
  // few rows, and empties itself once nothing is in progress.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    if ((await read($, bandMode)) === 'off') return next(e)
    const all = groupsForTab(await read($, groups), 'all', await read($, archive))
    const list = inProgress(all)
    if (list.length === 0) return next(e)

    return BandTree($, e, list)
  })
}
