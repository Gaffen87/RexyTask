// Draws the whole screen as lines of exactly the terminal's width. It reads no state of its own.
import type { SidebarEntry, TaskRow } from "./rows.ts"
import type { Due, Task } from "./todoist.ts"
import { displayWidth, fitToWidth, plainText, style, truncateToWidth, wrapToWidth } from "./text.ts"

export type TaskListState =
  | { status: "loading" }
  | { status: "loaded"; rows: TaskRow[] }
  | { status: "failed"; message: string; hints: string[] }

export type Column = "projects" | "tasks"

export type ViewState = {
  entries: SidebarEntry[]
  selectedEntryIndex: number
  taskList: TaskListState
  selectedTaskRowIndex: number
  focusedColumn: Column
  statusMessage: string
  todayDate: string
}

const KEY_HINTS = "↑↓ move   tab column   r refresh   q quit"
const DETAIL_HEIGHT = 4
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

export function localDateOf(moment: Date): string {
  const month = String(moment.getMonth() + 1).padStart(2, "0")
  const day = String(moment.getDate()).padStart(2, "0")
  return `${moment.getFullYear()}-${month}-${day}`
}

function daysBetween(fromDate: string, toDate: string): number {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86_400_000)
}

export function dueLabel(due: Due, todayDate: string): string {
  const [datePart = "", timePart] = due.date.split("T")
  const dayOffset = daysBetween(todayDate, datePart)
  let label: string
  if (dayOffset === 0) label = "Today"
  else if (dayOffset === 1) label = "Tomorrow"
  else if (dayOffset === -1) label = "Yesterday"
  else {
    const [year = "", month = "1", day = "1"] = datePart.split("-")
    label = `${Number(day)} ${MONTH_NAMES[Number(month) - 1] ?? month}`
    if (year !== todayDate.slice(0, 4)) label += ` ${year}`
  }
  if (timePart) label += ` ${timePart.slice(0, 5)}`
  return due.isRecurring ? `↻ ${label}` : label
}

function styledDue(due: Due, todayDate: string): { text: string; styled: string } {
  const text = dueLabel(due, todayDate)
  const dayOffset = daysBetween(todayDate, due.date.split("T")[0] ?? "")
  if (dayOffset < 0) return { text, styled: style.red(text) }
  if (dayOffset === 0) return { text, styled: style.green(text) }
  return { text, styled: text }
}

// Todoist's API counts priority upward: 4 is p1, the highest.
function priorityMarker(priority: number): string {
  if (priority === 4) return style.red("●")
  if (priority === 3) return style.yellow("●")
  if (priority === 2) return style.blue("●")
  return "○"
}

function priorityName(priority: number): string {
  return `p${5 - Math.min(4, Math.max(1, priority))}`
}

function highlight(line: string, isSelected: boolean, isFocused: boolean): string {
  if (!isSelected) return line
  return isFocused ? style.reverse(line) : style.reverse(style.dim(line))
}

// Keeps the selected row near the middle, so no scroll position needs storing.
export function scrollOffsetFor(selectedIndex: number, rowCount: number, visibleCount: number): number {
  const lastOffset = Math.max(0, rowCount - visibleCount)
  return Math.min(lastOffset, Math.max(0, selectedIndex - Math.floor(visibleCount / 2)))
}

function sidebarLines(state: ViewState, width: number, height: number): string[] {
  const scrollOffset = scrollOffsetFor(state.selectedEntryIndex, state.entries.length, height)
  const lines: string[] = []
  for (let lineIndex = 0; lineIndex < height; lineIndex++) {
    const entryIndex = scrollOffset + lineIndex
    const entry = state.entries[entryIndex]
    if (!entry) {
      lines.push(" ".repeat(width))
      continue
    }
    const line = fitToWidth(` ${"  ".repeat(entry.depth)}${entry.name}`, width)
    lines.push(highlight(line, entryIndex === state.selectedEntryIndex, state.focusedColumn === "projects"))
  }
  return lines
}

function taskLine(row: TaskRow, width: number, todayDate: string): string {
  if (row.kind === "section") return style.bold(fitToWidth(` ${row.name}`, width))
  const { task, depth, projectName } = row
  const indent = " ".repeat(1 + depth * 2)
  const due = task.due ? styledDue(task.due, todayDate) : null
  const trailingWidthLimit = Math.floor(width * 0.45)
  const dueText = due ? truncateToWidth(due.text, trailingWidthLimit) : ""
  const projectText = projectName
    ? truncateToWidth(projectName, trailingWidthLimit - displayWidth(dueText) - 2)
    : ""
  const trailingParts = [
    dueText && (dueText === due?.text ? due.styled : dueText),
    projectText && style.dim(projectText),
  ].filter(Boolean)
  const trailingWidth =
    displayWidth(dueText) + displayWidth(projectText) + (dueText && projectText ? 2 : 0)
  const titleWidth = width - displayWidth(indent) - 2 - (trailingWidth ? trailingWidth + 2 : 1)
  const title = fitToWidth(plainText(task.content), Math.max(0, titleWidth))
  const trailing = trailingWidth ? ` ${trailingParts.join("  ")} ` : " "
  return `${indent}${priorityMarker(task.priority)} ${title}${trailing}`
}

function messageLines(message: string, hints: string[], width: number): string[] {
  const textWidth = Math.max(1, width - 2)
  const lines = wrapToWidth(message, textWidth).map((line) => fitToWidth(` ${line}`, width))
  for (const hint of hints) {
    for (const line of wrapToWidth(hint, textWidth)) lines.push(style.dim(fitToWidth(` ${line}`, width)))
  }
  return lines
}

function detailLines(task: Task, projectName: string | undefined, width: number, todayDate: string): string[] {
  const metaParts = [priorityName(task.priority)]
  if (task.due) metaParts.push(`due ${dueLabel(task.due, todayDate)}`)
  if (projectName) metaParts.push(projectName)
  for (const label of task.labels ?? []) metaParts.push(`@${label}`)
  return [
    style.dim("─".repeat(width)),
    style.bold(fitToWidth(` ${plainText(task.content)}`, width)),
    style.dim(fitToWidth(` ${metaParts.join(" · ")}`, width)),
    fitToWidth(` ${plainText(task.description ?? "")}`, width),
  ]
}

function tasksColumnLines(state: ViewState, width: number, height: number): string[] {
  const { taskList } = state
  let lines: string[]
  if (taskList.status === "loading") {
    lines = [style.dim(fitToWidth(" Loading…", width))]
  } else if (taskList.status === "failed") {
    lines = messageLines(taskList.message, taskList.hints, width)
  } else if (taskList.rows.length === 0) {
    lines = [style.dim(fitToWidth(" No tasks", width))]
  } else {
    const selectedRow = taskList.rows[state.selectedTaskRowIndex]
    const showsDetail = selectedRow?.kind === "task" && height >= DETAIL_HEIGHT * 2
    const listHeight = showsDetail ? height - DETAIL_HEIGHT : height
    const scrollOffset = scrollOffsetFor(state.selectedTaskRowIndex, taskList.rows.length, listHeight)
    lines = taskList.rows.slice(scrollOffset, scrollOffset + listHeight).map((row, visibleIndex) => {
      const isSelected = row.kind === "task" && scrollOffset + visibleIndex === state.selectedTaskRowIndex
      return highlight(taskLine(row, width, state.todayDate), isSelected, state.focusedColumn === "tasks")
    })
    while (lines.length < listHeight) lines.push(" ".repeat(width))
    if (showsDetail) {
      lines.push(...detailLines(selectedRow.task, selectedRow.projectName, width, state.todayDate))
    }
  }
  while (lines.length < height) lines.push(" ".repeat(width))
  return lines.slice(0, height)
}

function taskCountLabel(taskList: TaskListState): string {
  if (taskList.status !== "loaded") return ""
  const taskCount = taskList.rows.filter((row) => row.kind === "task").length
  return taskCount === 1 ? "1 task" : `${taskCount} tasks`
}

export function renderScreen(state: ViewState, width: number, height: number): string[] {
  if (width < 30 || height < 5) return [truncateToWidth("RexyTask needs a larger pane", width)]
  const longestEntryWidth = Math.max(
    ...state.entries.map((entry) => displayWidth(entry.name) + entry.depth * 2),
  )
  const sidebarWidth = Math.min(Math.max(longestEntryWidth + 3, 16), Math.floor(width * 0.35))
  const tasksWidth = width - sidebarWidth - 1
  const bodyHeight = height - 3
  const divider = style.dim("│")

  const selectedEntryName = state.entries[state.selectedEntryIndex]?.name ?? ""
  const countLabel = taskCountLabel(state.taskList)
  const tasksHeading =
    style.bold(fitToWidth(` ${selectedEntryName}`, tasksWidth - displayWidth(countLabel) - 1)) +
    style.dim(`${countLabel} `)

  const sidebar = sidebarLines(state, sidebarWidth, bodyHeight)
  const tasks = tasksColumnLines(state, tasksWidth, bodyHeight)
  const statusWidth = Math.max(0, width - displayWidth(KEY_HINTS) - 3)
  const status = truncateToWidth(state.statusMessage, statusWidth)
  const footerGap = " ".repeat(Math.max(1, width - displayWidth(KEY_HINTS) - displayWidth(status) - 2))

  return [
    style.bold(fitToWidth(" Projects", sidebarWidth)) + divider + tasksHeading,
    style.dim("─".repeat(sidebarWidth) + "┼" + "─".repeat(tasksWidth)),
    ...sidebar.map((sidebarLine, lineIndex) => sidebarLine + divider + (tasks[lineIndex] ?? "")),
    style.dim(fitToWidth(` ${KEY_HINTS}${footerGap}${status}`, width)),
  ]
}
