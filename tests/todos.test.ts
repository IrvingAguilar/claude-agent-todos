import { describe, expect, test } from 'claude-code/testing'

import { layoutRows, wheelOffset, windowRows, wrappedRows } from '../hooks/layout'
import { lastTodos, mergeReloaded, taskListItems, archiveGroup, groupsForTab, isCollapsed, oddFeature, parseOddTasks, readArchive, restoreGroup, sameGroups, tokenize, upsertGroup } from '../hooks/parse'

const DOC = `# Feature
Objective: x

## Specs
- S1 something done

## Tasks
- [x] T1 S1 inline — parser (abc123)
- [ ] T2 S2 inline — a very long task description that should wrap across several rows in the pane when it does not fit
- [~] T3 S3 delegated — writer

| ID | Specs | Route | Status | Commit |
|----|-------|-------|--------|--------|
| T4 | S4 | inline | done | def456 |
| T5 | S5 | inline | in progress | |
| T6 | S6 | inline | pending | |

## Log
- [x] L1 not a task
`

describe('ODD feature documents', () => {
  test('detects ODD paths', async () => {
    expect(oddFeature('/repo/odd/tasks/agent-todos.md')).toBe('agent-todos')
    expect(oddFeature('odd/tasks/x.md')).toBe('x')
    expect(oddFeature('/repo/docs/tasks/x.md')).toBe(undefined)
  })

  test('a section with checkboxes takes only checkbox lines as tasks', async () => {
    const items = parseOddTasks(DOC)
    expect(items.map(item => [item.id, item.status, item.depth])).toEqual([
      ['T1', 'completed', 0],
      ['T2', 'pending', 0],
      ['T3', 'in_progress', 0],
    ])
  })

  test('a section with no checkbox falls back to top-level table rows', async () => {
    const items = parseOddTasks(`## Tasks
| ID | Specs | Route | Status | Commit |
|----|-------|-------|--------|--------|
| T4 | S4 | inline | done | def456 |
| T5 | S5 | inline | in progress | |
| T6 | S6 | inline | pending | |
`)
    expect(items.map(item => [item.id, item.status])).toEqual([
      ['T4', 'completed'],
      ['T5', 'in_progress'],
      ['T6', 'pending'],
    ])
  })

  test('nested tasks keep their depth and a task body (tables, notes) is no task', async () => {
    const doc = [
      '## Tasks',
      '- [ ] **TA-1** - Contract',
      '  - [x] **TA-1d** - Error mapping. Upload rows use `UploadFailureReason`',
      '',
      '    | Wire | Reason |',
      '    | --- | --- |',
      '    | `409 DUPLICATE_FILE` | duplicate |',
      '    | `5xx`, or an unknown `4xx` | server |',
      '    - **Risk:** `BffApiClient` rewrites a request',
      '    - Acceptance: every row above is covered by a test',
      '',
      '  - [x] **TA-1e** - Reason-string mapping',
      '    - Acceptance: whichever way D2 goes',
      '- [x] **TA-2** - Port refinements.',
      '  - Files: `domain/BulkInvoicesRepository.ts`',
      '  - [x] **TA-2a** - Per-file key (review finding M2).',
      '    - Today progress matches a row by file name',
      '	- [ ] **TA-2b** - Per-file settled callback, tab-indented',
      '  - Depends on: the decisions; `TA-1c` for `TA-2a`.',
      '```',
      '- [ ] not a task, inside a code block',
      '```',
      '## Log',
    ].join('\n')
    const items = parseOddTasks(doc)
    expect(items.map(item => [item.id, item.status, item.depth])).toEqual([
      ['TA-1', 'pending', 0],
      ['TA-1d', 'completed', 1],
      ['TA-1e', 'completed', 1],
      ['TA-2', 'completed', 0],
      ['TA-2a', 'completed', 1],
      ['TA-2b', 'pending', 1],
    ])
    expect(items[1]?.text).toBe('TA-1d - Error mapping. Upload rows use `UploadFailureReason`')
  })

  test('repeated ids stay unique', async () => {
    const items = parseOddTasks('## Tasks\n- [ ] T1 a\n- [ ] T1 b\n')
    expect(items.map(item => item.id)).toEqual(['T1', 'T1~2'])
  })

  test('drops empty agent groups but keeps ODD ones', async () => {
    const odd = { id: 'odd:a', label: 'a', kind: 'odd' as const, items: [], updatedAt: 0 }
    const agent = { id: 'agent:main', label: 'm', kind: 'agent' as const, items: [], updatedAt: 0 }
    expect(upsertGroup([], odd)).toHaveLength(1)
    expect(upsertGroup([agent], agent)).toHaveLength(0)
  })
})

describe('drawing', () => {
  test('the pane says when there is nothing yet', async $ => {
    const ui = await $.ui.mount({
      plugin: 'agent-todos',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'agent-todos',
      props: { title: 'Todos', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { top: 0, bodyRows: 20, contentRows: 0 }, view: {} } as never,
      viewport: { columns: 160, rows: 40 } as never,
    })
    expect(await ui.find({ type: 'Text', text: /No agent tasks yet/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('coloring', () => {
  test('splits ids, specs, commits and routes apart', async () => {
    
    expect(tokenize('TA-1d').map(t => t.kind)).toEqual(['id'])
    expect(tokenize('T2 S3-S4 inline abc1234 done').map(t => t.kind)).toEqual([
      'id', 'plain', 'spec', 'plain', 'route', 'plain', 'commit', 'plain',
    ])
  })
})

describe('colored drawing', () => {
  test('draws a TodoWrite list with theme colors in the pane', async ($, on) => {
    on('tool.call', { tool: 'TodoWrite' }, async () => ({ result: { oldTodos: [], newTodos: [] } }) as never)
    await $.tool.call({
      tool: 'TodoWrite',
      todos: [
        { content: 'T1 S1 inline write parser abc1234', status: 'completed', activeForm: 'Writing parser' },
        { content: 'T2 S2 draw pane', status: 'in_progress', activeForm: 'Drawing T2 pane with a long text that wraps across rows' },
        { content: 'T3 blocked on review', status: 'pending', activeForm: 'x' },
      ],
    } as never)
    const ui = await $.ui.mount({
      plugin: 'agent-todos',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'agent-todos',
      props: { title: 'Todos', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { top: 0, bodyRows: 20, contentRows: 0 }, view: {} } as never,
      viewport: { columns: 160, rows: 40 } as never,
    })
    expect(await ui.find({ type: 'Text', text: /Main agent/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: / 1\/3 / })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '✖' })).toBeDefined()
    await ui.unmount()
  })
})

describe('no needless redraws', () => {
  const a = { id: 'agent:a', label: 'a', kind: 'agent' as const, items: [{ id: '0', text: 'x', status: 'pending' as const }], updatedAt: 1 }
  const b = { id: 'agent:b', label: 'b', kind: 'agent' as const, items: [{ id: '0', text: 'y', status: 'pending' as const }], updatedAt: 1 }

  test('an unchanged list counts as the same, whatever its timestamps', async () => {
    expect(sameGroups([a, b], upsertGroup([a, b], { ...a, updatedAt: 99 }))).toBe(true)
  })

  test('an update keeps the group where it stands', async () => {
    const changed = upsertGroup([a, b], { ...b, items: [{ id: '0', text: 'y', status: 'completed' }] })
    expect(changed.map(group => group.id)).toEqual(['agent:a', 'agent:b'])
    expect(sameGroups([a, b], changed)).toBe(false)
  })
})

describe('tabs and archive', () => {
  test('archives a group to the store and restores it from the Archived tab', async ($, on) => {
    const store = new Map<string, unknown>()
    on('session.cwd', async () => ({ value: '/project' }))
    on('store.get', async (_$, e) => ({ value: store.get(e.key) }))
    on('store.set', async (_$, e) => {
      store.set(e.key, e.value)

      return { value: undefined }
    })
    on('tool.call', { tool: 'TodoWrite' }, async () => ({ result: { oldTodos: [], newTodos: [] } }) as never)
    await $.tool.call({
      tool: 'TodoWrite',
      todos: [{ content: 'T1 write parser', status: 'pending', activeForm: 'Writing parser' }],
    } as never)
    const ui = await $.ui.mount({
      plugin: 'agent-todos',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'agent-todos',
      props: { title: 'Todos', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { top: 0, bodyRows: 30, contentRows: 0 }, view: {} } as never,
      viewport: { columns: 160, rows: 40 } as never,
    })
    await ui.press({ key: 'archive:agent:main' })
    expect(await ui.find({ type: 'Text', text: /T1 write parser/ })).toBeUndefined()

    const key = 'archive:/project'
    const stored = readArchive(store.get(key))
    expect(stored.map(one => one.sourceId)).toEqual(['agent:main'])
    const archivedId = stored[0]?.id ?? ''

    await ui.press({ key: 'tab:archived' })
    expect(await ui.find({ type: 'Text', text: /T1 write parser/ })).toBeDefined()
    await ui.press({ key: `restore:${archivedId}` })
    expect(await ui.find({ type: 'Text', text: /T1 write parser/ })).toBeUndefined()
    expect(readArchive(store.get(key))).toEqual([])

    await ui.press({ key: 'tab:agents' })
    expect(await ui.find({ type: 'Text', text: /T1 write parser/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('archive persistence', () => {
  test('a new session shows the archive stored by an earlier one, and archiving adds to it', async ($, on) => {
    const key = 'archive:/project'
    const earlier = { id: 'agent:main@1', sourceId: 'agent:main', archivedAt: 1, label: 'Main agent', kind: 'agent', items: [{ id: '0', text: 'Old archived task', status: 'pending' }], updatedAt: 1 }
    const store = new Map<string, unknown>([[key, [earlier]]])
    on('session.cwd', async () => ({ value: '/project' }))
    on('store.get', async (_$, e) => ({ value: store.get(e.key) }))
    on('store.set', async (_$, e) => {
      store.set(e.key, e.value)

      return { value: undefined }
    })
    on('command.register', async () => ({ value: undefined }) as never)
    on('ui.open', async () => ({ value: { isPlaced: true } }) as never)
    on('session.start', async (_$, e) => e as never)
    on('fs.list', async () => ({ value: [] }) as never)
    on('tool.call', { tool: 'TodoWrite' }, async () => ({ result: { oldTodos: [], newTodos: [] } }) as never)
    await $.session.start({ cwd: '/project', surface: 'terminal' } as never)

    await $.tool.call({
      tool: 'TodoWrite',
      todos: [{ content: 'New task', status: 'pending', activeForm: 'Doing it' }],
    } as never)
    const ui = await $.ui.mount({
      plugin: 'agent-todos',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'agent-todos',
      props: { title: 'Todos', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { top: 0, bodyRows: 30, contentRows: 0 }, view: {} } as never,
      viewport: { columns: 160, rows: 40 } as never,
    })
    await ui.press({ key: 'archive:agent:main' })
    expect(readArchive(store.get(key)).map(one => one.id)).toHaveLength(2)
    expect(readArchive(store.get(key))[1]?.id).toBe('agent:main@1')

    await ui.press({ key: 'tab:archived' })
    expect(await ui.find({ type: 'Text', text: /Old archived task/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('archive across sessions', () => {
  const odd = { id: 'odd:feat', label: 'ODD · feat', kind: 'odd' as const, items: [{ id: 'T1', text: 'T1', status: 'pending' as const }], updatedAt: 0 }
  const main = { id: 'agent:main', label: 'Main agent', kind: 'agent' as const, items: [{ id: '0', text: 'x', status: 'pending' as const }], updatedAt: 0 }

  test('an archived ODD feature stays hidden and shows its current tasks under Archived', async () => {
    const archive = archiveGroup([], odd, 5)
    const updated = { ...odd, items: [{ id: 'T1', text: 'T1', status: 'completed' as const }] }
    expect(groupsForTab([updated, main], 'all', archive).map(one => one.id)).toEqual(['agent:main'])
    expect(groupsForTab([updated], 'archived', archive)[0]?.items[0]?.status).toBe('completed')
    expect(archiveGroup(archive, odd, 6)).toHaveLength(1)
  })

  test('an agent snapshot gets its own id, and restores beside a newer list of that agent', async () => {
    const archive = archiveGroup([], main, 7)
    expect(archive[0]?.id).toBe('agent:main@7')
    const restored = restoreGroup([main], archive[0]!)
    expect(restored.map(one => one.id)).toEqual(['agent:main@7', 'agent:main'])
    expect(restoreGroup([], archive[0]!).map(one => one.id)).toEqual(['agent:main'])
  })

  test('reads back only well-formed snapshots from the store', async () => {
    expect(readArchive(undefined)).toEqual([])
    expect(readArchive([{ id: 'a', sourceId: 'a', items: [] }, { nope: true }])).toHaveLength(1)
  })
})

describe('folding groups', () => {
  const PANE = {
    plugin: 'agent-todos',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'agent-todos',
    props: { title: 'Todos', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { top: 0, bodyRows: 30, contentRows: 0 }, view: {} } as never,
    viewport: { columns: 160, rows: 40 } as never,
  } as const

  test('a finished group is folded unless the person chose otherwise', async () => {
    const group = { id: 'g', label: 'g', kind: 'agent' as const, items: [{ id: '0', text: 'x', status: 'completed' as const }], updatedAt: 0 }
    expect(isCollapsed(group, {})).toBe(true)
    expect(isCollapsed(group, { g: false })).toBe(false)
    expect(isCollapsed({ ...group, items: [{ id: '0', text: 'x', status: 'pending' }] }, {})).toBe(false)
    expect(isCollapsed({ ...group, items: [] }, {})).toBe(false)
  })

  test('folds a finished group by default and unfolds it with its button', async ($, on) => {
    on('tool.call', { tool: 'TodoWrite' }, async () => ({ result: { oldTodos: [], newTodos: [] } }) as never)
    await $.tool.call({
      tool: 'TodoWrite',
      todos: [{ content: 'ship the parser', status: 'completed', activeForm: 'Shipping' }],
    } as never)
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ type: 'Text', text: /ship the parser/ })).toBeUndefined()
    await ui.press({ key: 'toggle:agent:main' })
    expect(await ui.find({ type: 'Text', text: /ship the parser/ })).toBeDefined()
    await ui.press({ key: 'toggle:agent:main' })
    expect(await ui.find({ type: 'Text', text: /ship the parser/ })).toBeUndefined()
    await ui.unmount()
  })

  test('folds a group still in progress with its button', async ($, on) => {
    on('tool.call', { tool: 'TodoWrite' }, async () => ({ result: { oldTodos: [], newTodos: [] } }) as never)
    await $.tool.call({
      tool: 'TodoWrite',
      todos: [{ content: 'draw the pane', status: 'pending', activeForm: 'Drawing' }],
    } as never)
    const ui = await $.ui.mount(PANE)
    expect(await ui.find({ type: 'Text', text: /draw the pane/ })).toBeDefined()
    await ui.press({ key: 'toggle:agent:main' })
    expect(await ui.find({ type: 'Text', text: /draw the pane/ })).toBeUndefined()
    await ui.unmount()
  })
})

describe('fast scrolling', () => {
  const group = (id: string, n: number) => ({
    id,
    label: id,
    kind: 'agent' as const,
    items: Array.from({ length: n }, (_, i) => ({ id: String(i), text: `task ${i}`, status: 'pending' as const })),
    updatedAt: 0,
  })

  test('estimates wrapped rows by words, wide characters counting twice', async () => {
    expect(wrappedRows('short', 20)).toBe(1)
    expect(wrappedRows('aaaa bbbb cccc', 9)).toBe(2)
    expect(wrappedRows('x'.repeat(25), 10)).toBe(3)
    expect(wrappedRows('日本語日本語', 6)).toBe(2)
  })

  test('lays out header, bar, tasks and a gap per group; folded groups drop their tasks', async () => {
    const rows = layoutRows([group('a', 2)], {}, 40, 'none')
    expect(rows.map(row => row.kind)).toEqual(['header', 'bar', 'item', 'item', 'gap'])
    expect(layoutRows([group('a', 2)], { a: true }, 40, 'none').map(row => row.kind)).toEqual(['header', 'bar', 'gap'])
  })

  test('draws only rows near the window and keeps the total height', async () => {
    const rows = layoutRows([group('a', 100)], {}, 40, 'none')
    const total = rows.reduce((sum, row) => sum + row.height, 0)
    const window = windowRows(rows, 2, 50, 10, 10)
    const shown = window.rows.reduce((sum, row) => sum + row.height, 0)
    expect(window.before + shown + window.after).toBe(total)
    expect(window.rows.length).toBeLessThan(40)
    expect(window.before).toBeGreaterThan(0)
  })

  test('a wheel tick scrolls the pane three rows; keys keep their step', async () => {
    const at = { bodyRows: 10, contentRows: 100 }
    expect(wheelOffset({ ...at, offset: 21, by: 1, isWheel: true })).toBe(23)
    expect(wheelOffset({ ...at, offset: 19, by: -1, isWheel: true })).toBe(17)
    expect(wheelOffset({ ...at, offset: 1, by: -1, isWheel: true })).toBe(0)
    expect(wheelOffset({ ...at, offset: 90, by: 1, isWheel: true })).toBe(90)
    expect(wheelOffset({ ...at, offset: 21, by: 1, isWheel: false })).toBe(21)
  })
})

describe('drawing only what is near the window', () => {
  test('a long list draws its first tasks, not its last', async ($, on) => {
    on('tool.call', { tool: 'TodoWrite' }, async () => ({ result: { oldTodos: [], newTodos: [] } }) as never)
    await $.tool.call({
      tool: 'TodoWrite',
      todos: Array.from({ length: 120 }, (_, i) => ({ content: `job number ${i}`, status: 'pending', activeForm: 'x' })),
    } as never)
    const ui = await $.ui.mount({
      plugin: 'agent-todos',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'agent-todos',
      props: { title: 'Todos', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } as never,
      viewport: { columns: 160, rows: 40 } as never,
    })
    expect(await ui.find({ type: 'Text', text: /job number 0$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /job number 119$/ })).toBeUndefined()
    await ui.unmount()
  })
})

describe('/todos reload', () => {
  test('reads the last TodoWrite, TaskList answers and merges in place', async () => {
    const uses = [
      { tool: 'TodoWrite', input: { todos: [{ content: 'old', status: 'pending', activeForm: 'x' }] } },
      { tool: 'Read', input: {} },
      { tool: 'TodoWrite', input: { todos: [{ content: 'new', status: 'in_progress', activeForm: 'Doing new' }, { bad: 1 }] } },
    ]
    expect(lastTodos(uses)).toEqual([{ id: '0', text: 'Doing new', status: 'in_progress' }])
    expect(lastTodos([])).toBe(undefined)
    expect(taskListItems({ tasks: [{ id: '1', subject: 'a', status: 'completed', blockedBy: [] }, { id: 2 }] })).toEqual([
      { id: '1', text: 'a', status: 'completed' },
    ])
    const g = (id: string, text: string) => ({ id, label: id, kind: 'agent' as const, items: [{ id: '0', text, status: 'pending' as const }], updatedAt: 0 })
    expect(mergeReloaded([g('a', 'x'), g('b', 'x'), g('gone', 'x')], [g('c', 'y'), g('b', 'y'), g('a', 'y')]).map(one => one.id)).toEqual([
      'a', 'b', 'c',
    ])
  })

  test('the command rebuilds the pane from the transcript and TaskList', async ($, on) => {
    on('session.cwd', async () => ({ value: '/project' }))
    on('store.get', async () => ({ value: undefined }))
    on('agent.list', async () => ({ value: [] }))
    on('fs.list', async () => ({ value: [] }))
    on('session.messages', async () => ({
      value: [{ role: 'assistant', text: '', toolUses: [{ tool_use_id: 'u1', tool: 'TodoWrite', input: { todos: [{ content: 'from transcript', status: 'pending', activeForm: 'x' }] } }] }],
    }) as never)
    on('tool.call', { tool: 'TaskList' }, async () => ({ result: { tasks: [{ id: '7', subject: 'listed task', status: 'in_progress', blockedBy: [] }] } }) as never)

    const ran = await $.command.run({ command: 'todos', args: 'reload' } as never)
    expect(JSON.stringify(ran)).toContain('Todos reloaded: 2 agent and task groups, 0 ODD features.')

    const ui = await $.ui.mount({
      plugin: 'agent-todos',
      surface: 'terminal',
      component: 'Pane',
      requestId: 'agent-todos',
      props: { title: 'Todos', isFocused: false, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} } as never,
      viewport: { columns: 160, rows: 40 } as never,
    })
    expect(await ui.find({ type: 'Text', text: /from transcript/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /listed task/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('band above the prompt', () => {
  type Ctx = Parameters<Parameters<typeof test>[1]>
  // Stands in for TodoWrite, the pane list and the engine's own band beneath the mod.
  const engine = (on: Ctx[1]) => {
    on('tool.call', { tool: 'TodoWrite' }, async () => ({ result: { oldTodos: [], newTodos: [] } }) as never)
    on('ui.panes', async () => ({ value: [] }) as never)
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Text } = $.ui.resolve(e)

      return h(Text, {}, 'engine band') as never
    })
  }
  const mountBand = ($: Ctx[0], columns: number) =>
    $.ui.mount({
      plugin: 'agent-todos',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: true } as never,
      viewport: { columns, rows: 40 } as never,
    })

  test('shows only the tasks in progress, on a wide terminal too', async ($, on) => {
    engine(on)
    await $.tool.call({
      tool: 'TodoWrite',
      todos: [
        { content: 'Write parser', status: 'completed', activeForm: 'Writing parser' },
        { content: 'Draw band', status: 'in_progress', activeForm: 'Drawing the band' },
        { content: 'Ship it', status: 'pending', activeForm: 'Shipping' },
      ],
    } as never)
    const ui = await mountBand($, 160)
    expect(await ui.find({ type: 'Text', text: /Drawing the band/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Main agent/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Ship it/ })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: /Writ/ })).toBe(undefined)
    await ui.unmount()
  })

  test('leaves the engine its band when no task is in progress', async ($, on) => {
    engine(on)
    await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Ship it', status: 'pending', activeForm: 'Shipping' }] } as never)
    const ui = await mountBand($, 80)
    expect(await ui.find({ type: 'Text', text: /Ship it/ })).toBe(undefined)
    expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
    await ui.unmount()
  })

  test('/todos band off still hides it', async ($, on) => {
    engine(on)
    await $.tool.call({ tool: 'TodoWrite', todos: [{ content: 'Draw band', status: 'in_progress', activeForm: 'Drawing the band' }] } as never)
    await $.command.run({ command: 'todos', args: 'band off' } as never)
    const ui = await mountBand($, 160)
    expect(await ui.find({ type: 'Text', text: /Drawing the band/ })).toBe(undefined)
    await ui.unmount()
  })
})
