import type { TodoGroup, TodoItem } from '../types'
import { counts, isCollapsed } from './parse'

/**
 * The pane's tree as flat rows with the height each takes on screen, so the
 * pane can draw only the rows near the scroll window and stand empty boxes of
 * the same height in for the rest.
 */
export type Row =
  | { kind: 'header'; key: string; height: number; group: TodoGroup; isFolded: boolean }
  | { kind: 'bar'; key: string; height: number; group: TodoGroup }
  | { kind: 'item'; key: string; height: number; group: TodoGroup; item: TodoItem }
  | { kind: 'gap'; key: string; height: number }
  | { kind: 'empty'; key: string; height: number }

/** The icon column in front of a task's text. */
export const ICON_COLUMNS = 2

/** Columns a subtask is indented per level under its parent. */
export const DEPTH_COLUMNS = 2

/** Cells a character takes on a terminal: wide East Asian and emoji take 2. */
export function cellWidth(char: string): number {
  const code = char.codePointAt(0) ?? 0
  if (code < 0x1100) return 1
  const isWide =
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe4f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff)

  return isWide ? 2 : 1
}

function textWidth(text: string): number {
  let width = 0
  for (const char of text) width += cellWidth(char)

  return width
}

/**
 * The rows a text takes word-wrapped into `width` cells, as the terminal
 * wraps a `Text` with `wrap="wrap"`: by words, a word wider than a row broken.
 */
export function wrappedRows(text: string, width: number): number {
  const room = Math.max(1, width)
  let rows = 0
  for (const line of text.split('\n')) {
    let used = 0
    let lineRows = 1
    for (const word of line.split(/\s+/).filter(one => one !== '')) {
      const size = textWidth(word)
      const need = used === 0 ? size : used + 1 + size
      if (need <= room) {
        used = need
        continue
      }
      if (used > 0) lineRows += 1
      lineRows += Math.max(0, Math.ceil(size / room) - 1)
      used = size % room === 0 ? room : size % room
    }
    rows += lineRows
  }

  return Math.max(1, rows)
}

/** The rows the tab bar takes: its buttons wrap as a row of `[ label ]`s. */
export function tabsHeight(labels: readonly string[], columns: number): number {
  let rows = 1
  let used = 0
  for (const label of labels) {
    const size = textWidth(label) + 4
    if (used > 0 && used + size > columns) {
      rows += 1
      used = 0
    }
    used += size
  }

  return rows + 1
}

export function layoutRows(
  list: readonly TodoGroup[],
  chosen: Readonly<Record<string, boolean>>,
  columns: number,
  emptyText: string,
): Row[] {
  if (list.length === 0) return [{ kind: 'empty', key: 'empty', height: wrappedRows(emptyText, columns) }]
  const rows: Row[] = []
  for (const group of list) {
    const isFolded = isCollapsed(group, chosen)
    rows.push({ kind: 'header', key: `header:${group.id}`, height: 1, group, isFolded })
    if (counts(group.items).total > 0) rows.push({ kind: 'bar', key: `bar:${group.id}`, height: 1, group })
    if (!isFolded) {
      for (const item of group.items) {
        rows.push({
          kind: 'item',
          key: `${group.id}:${item.id}`,
          height: wrappedRows(item.text, columns - ICON_COLUMNS - DEPTH_COLUMNS * (item.depth ?? 0)),
          group,
          item,
        })
      }
    }
    rows.push({ kind: 'gap', key: `gap:${group.id}`, height: 1 })
  }

  return rows
}

export type RowWindow = { before: number; rows: Row[]; after: number }

/**
 * The rows that overlap the scroll window, `margin` rows to each side, and the
 * heights of the rows left out above and below it. `top` is where the first
 * row starts in the tree (below the tab bar).
 */
export function windowRows(rows: readonly Row[], top: number, offset: number, bodyRows: number, margin: number): RowWindow {
  const from = offset - margin
  const to = offset + bodyRows + margin
  let at = top
  let before = 0
  let after = 0
  const shown: Row[] = []
  for (const row of rows) {
    const end = at + row.height
    if (end <= from) before += row.height
    else if (at >= to) after += row.height
    else shown.push(row)
    at = end
  }

  return { before, rows: shown, after }
}

/** How many rows one wheel tick moves the pane. */
export const WHEEL_STEP = 3

/**
 * Where a scroll lands with wheel ticks sped up: `offset` is where the engine
 * would land (the window's row plus `by`); a key's move (no pointer) or a
 * plugin's is left as it is.
 */
export function wheelOffset(move: {
  offset: number
  by: number
  bodyRows: number
  contentRows: number
  isWheel: boolean
}): number {
  if (!move.isWheel) return move.offset
  const from = move.offset - move.by
  const last = Math.max(0, move.contentRows - move.bodyRows)

  return Math.min(last, Math.max(0, from + move.by * WHEEL_STEP))
}
