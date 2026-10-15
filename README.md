# agent-todos

A Claude Code mod that shows, live, the tasks your agents are working on: the
main agent's and every subagent's todo lists, the session's tasks, and the
tasks of [gentle-ai](https://github.com/Gentleman-Programming/gentle-ai) ODD
feature documents (`odd/tasks/<feature>.md`).

```
[ All 4 ] [ Agents 2 ] [ ODD 1 ] [ Tasks 1 ] [ Archived 0 ]

▾ ● Main agent                                  2/4  [ Archive ]
━━━━━━━━━━━━
✔ Write the parser
◐ Drawing the pane
○ Add tests for long task text that wraps
  across several rows
✖ Ship it, blocked on review

▸ ◆ ODD · bulk-invoices-api-adapter            15/15 [ Archive ]
━━━━━━━━━━━━
```

## Install

In a Claude Code terminal session:

```
/plugin install agent-todos --marketplace IrvingAguilar/claude-agent-todos
```

Answer `y` to add the marketplace, then pick the user scope. The mod is
active right away, in every session from then on. For a private repository,
each person needs read access and git (or `gh`) signed in to GitHub.

The line works in a terminal session. A local session that the desktop app
starts loads the mod too once it is installed at the user scope.

### Update

```
claude plugin marketplace update
claude plugin update agent-todos@local-mods --scope user
```

Then `/reload-plugins` in an open session. The marketplace update alone only
refreshes the listing; `plugin update` installs the new version.

### Develop from a local checkout

To keep the installed mod in step with a checkout you edit:

```bash
git clone git@github.com:IrvingAguilar/claude-agent-todos.git ~/dev/claude-agent-todos
mkdir -p ~/.claude/mods
ln -s ~/dev/claude-agent-todos ~/.claude/mods/agent-todos
claude plugin marketplace add ~/.claude/mods/agent-todos
claude plugin install agent-todos@local-mods --scope user
```

The install is a copy of the checkout, cached per version under
`~/.claude/plugins/cache/local-mods/agent-todos/<version>/`, so `/reload-plugins`
alone does not pick up your edits. To load them:

1. Bump `version` in `.claude-plugin/plugin.json`.
2. Run:

   ```bash
   claude plugin marketplace update local-mods
   claude plugin update agent-todos@local-mods --scope user
   ```

3. Run `/reload-plugins` in open sessions; new sessions load it on start.

To try your edits for one session only, without installing:
`claude --plugin-dir ~/dev/claude-agent-todos`.

## How it works

### Where the tasks come from

| Source                                    | Group                                                     | Updated when                                                                                    |
| ----------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `TodoWrite` calls                         | `● <agent>`, one per agent (main agent and each subagent) | the agent writes its list                                                                       |
| `TaskCreate` / `TaskUpdate` calls         | `■ Session tasks`                                         | a task is created, updated or deleted                                                           |
| `odd/tasks/*.md` in the working directory | `◆ ODD · <feature>`, one per document                     | the session starts, an agent writes or edits the document, or a turn ends and its tasks changed |

The mod never polls. It writes its list only when what it draws changed, so
the pane does not redraw unless an agent changed something.

### ODD feature documents

The mod reads the `## Tasks` section of each document, up to the next `##`
heading.

- A task is a checkbox line: `- [ ]` pending, `- [x]` done, and `- [~]`,
  `- [-]` or `- [/]` in progress.
- A checkbox indented under another is its subtask, with tabs or any space
  width. The pane indents it under its parent.
- Everything else in the section is the body of its task (notes, tables,
  plain bullets) and is never a task. Checkboxes inside fenced code blocks
  are ignored.
- Task IDs such as `T1`, `TA-1` or `TA-1d` are recognised and colored, and
  `**bold**` markers are dropped from the text.
- A `## Tasks` section with no checkbox at all falls back to its unindented
  table rows (`| T1 | S1 | inline | done |`) and `T1 ...` bullets, reading the
  status from words such as `done`, `in progress` or `pending`.

### The pane and the band

- **Side pane.** It opens when the session starts. It docks beside the
  transcript in a fullscreen terminal at least 110 columns wide; from 144
  columns it shows up on its own, and in between run `/todos` to open it.
- **Band above the prompt.** It shows only the tasks in progress right now,
  under the title of the agent, task list or ODD feature they belong to, at
  any terminal width and beside the pane. It empties itself once nothing is
  in progress. Hide it with `/todos band off`.

The pane's buttons and hotkeys need the keyboard: click the pane or press
`ctrl+x tab`.

### Tabs

`All`, `Agents`, `ODD`, `Tasks` and `Archived`, each with its group count.
Keys `1` to `5` switch tabs.

### Folding

Each group has `▾` (open) or `▸` (folded) in front of its title. A group whose
tasks are all done starts folded; any other starts open. A choice you make
stays for the rest of the session. A folded group keeps its title, its count
and its progress bar.

### Archive

- `[ Archive ]` on a group sends it to the `Archived` tab.
- Agent and session-task groups are archived as a snapshot. A later list from
  the same agent shows up as a new live group.
- An ODD feature is archived by name. It stays hidden from the live tabs and
  shows its document's current tasks under `Archived`.
- `[ Restore ]` brings a group back. `[ Delete ]` removes an archived agent or
  task group; ODD features have no Delete, since their document still exists.
- The archive is kept across sessions, per project directory, in the mod's
  own local store, up to 200 groups per project. It never touches your
  `.md` files or Engram.

### Look

- **Icons:** `✔` done, `◐` in progress, `○` pending, `✖` blocked. A task counts
  as blocked when its text says `blocked`, `failed`, `error` (or the Spanish
  `bloqueada`, `falló`) or has `❌`.
- **Colors:** every color is a theme key, so the pane follows your Claude Code
  theme.
- **Long text:** task text wraps onto as many rows as it needs, indented
  under its icon.

### Scrolling

A wheel tick scrolls the pane 3 rows; the arrow, Page Up/Down and Home/End
keys keep their own steps. The pane draws only the rows near the visible
window and stands empty boxes of the same height in for the rest, so long
lists scroll quickly.

## Commands

| Command            | What it does                                                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/todos`           | Opens the pane and re-reads the ODD documents.                                                                                                                                                                    |
| `/todos reload`    | Rebuilds the list from its sources: each agent's last `TodoWrite` in its transcript, the session's tasks as `TaskList` returns them, every `odd/tasks/*.md`, and the archive. Groups no longer found are dropped. |
| `/todos band on`   | Shows the in-progress tasks above the prompt.                                                                                                                                                                     |
| `/todos band off`  | Never shows the band.                                                                                                                                                                                             |
| `/todos band auto` | Same as `on` (the default).                                                                                                                                                                                       |
| `/todos clear`     | Empties the live list. The archive is kept.                                                                                                                                                                       |

## Limits

- Tasks created before the mod loaded show up only after `/todos reload`.
- `/todos reload` reads the newest 4096 messages of each transcript. An agent
  whose last `TodoWrite` is older than that is dropped from the list.
- The active tab and the fold choices last for the session only.
- A parent ODD task shows its own checkbox, not one derived from its subtasks.
- Wrapped task heights are estimated. If the estimate is off, the pane can
  shift a row or two while scrolling.

## Development

```
hooks/register.tsx   hooks: tool calls, commands, the pane and the band
hooks/parse.ts       ODD parsing, groups, tabs, archive (pure functions)
hooks/layout.ts      row heights, the visible window, wheel steps (pure functions)
types/index.d.ts     the mod's state contract
tests/todos.test.ts  tests
```

```bash
claude plugin validate .   # checks the manifest and the hooks module
claude plugin test .       # runs tests/*.test.ts against the engine
```

Mods use Claude Code's function-hooks plugin API, which is in early access and
may change between releases.
