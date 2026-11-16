// Draws the whole screen, in the style of lazygit, as lines of exactly the terminal's width.
// It reads no state of its own.
import type { ClaudeStatus, ClaudeStatuses } from "./claudeStatus.ts"
import { subtaskCountAt, visibleRowIndexes, type SidebarEntry, type TaskRow } from "./rows.ts"
import type { Due, Task } from "./todoist.ts"
import { displayWidth, fitToWidth, plainText, style, truncateToWidth, wrapToWidth } from "./text.ts"

export type TaskListState =
  | { status: "loading" }
  | { status: "loaded"; rows: TaskRow[] }
  | { status: "failed"; message: string; hints: string[] }

export type SourcePanel = "views" | "projects"
export type Panel = SourcePanel | "tasks"

export type ViewState = {
  views: SidebarEntry[]
  projects: SidebarEntry[]
  selectedViewIndex: number
  selectedProjectIndex: number
  activeSource: SourcePanel
  focusedPanel: Panel
  taskList: TaskListState
  selectedTaskRowIndex: number
  expandedTaskIds: ReadonlySet<string>
  claudeStatuses: ClaudeStatuses
  statusMessage: string
  todayDate: string
}

const KEY_HINTS: [key: string, action: string][] = [
  ["↑↓", "move"],
  ["tab", "panel"],
  ["enter", "open/close"],
  ["d", "done"],
  ["u", "undo"],
  ["s", "send to Claude"],
  ["r", "refresh"],
  ["q", "quit"],
]
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

function colorOfDue(due: Due, todayDate: string): (text: string) => string {
  const dayOffset = daysBetween(todayDate, due.date.split("T")[0] ?? "")
  if (dayOffset < 0) return style.red
  if (dayOffset === 0) return style.green
  return (text) => text
}

// Todoist's API counts priority upward: 4 is p1, the highest.
function priorityMarker(priority: number): string {
  if (priority === 4) return style.red("●")
  if (priority === 3) return style.yellow("●")
  if (priority === 2) return style.cyan("●")
  return "○"
}

function priorityName(priority: number): string {
  return `p${5 - Math.min(4, Math.max(1, priority))}`
}

function claudeLabel(status: ClaudeStatus): { text: string; color: (text: string) => string } {
  if (status.state === "done") return { text: "✓ done", color: style.green }
  if (status.state === "working") return { text: "⟳ working", color: style.magenta }
  return { text: "→ sent", color: style.magenta }
}

function highlight(line: string, isSelected: boolean, isFocused: boolean): string {
  if (!isSelected) return line
  return isFocused ? style.blueBackground(style.bold(line)) : style.bold(line)
}

// Keeps the selected row near the middle, so no scroll position needs storing.
export function scrollOffsetFor(selectedIndex: number, rowCount: number, visibleCount: number): number {
  const lastOffset = Math.max(0, rowCount - visibleCount)
  return Math.min(lastOffset, Math.max(0, selectedIndex - Math.floor(visibleCount / 2)))
}

type PanelFrame = {
  title: string
  footer?: string
  width: number
  height: number
  isFocused: boolean
  contentLines: string[]
}

function framePanel({ title, footer = "", width, height, isFocused, contentLines }: PanelFrame): string[] {
  if (height <= 0) return []
  const focusedStyle = (text: string) => style.green(style.bold(text))
  const border = isFocused ? focusedStyle : style.dim
  const label = isFocused ? focusedStyle : (text: string) => text
  const innerWidth = width - 2
  const shownTitle = truncateToWidth(title, innerWidth - 2)
  const shownFooter = truncateToWidth(footer, innerWidth - 2)
  const topRule = "─".repeat(innerWidth - 1 - displayWidth(shownTitle))
  const bottomRule = "─".repeat(innerWidth - 1 - displayWidth(shownFooter))
  const framed = [border("╭─") + label(shownTitle) + border(`${topRule}╮`)]
  for (let lineIndex = 0; lineIndex < height - 2; lineIndex++) {
    framed.push(border("│") + (contentLines[lineIndex] ?? " ".repeat(innerWidth)) + border("│"))
  }
  framed.push(border(`╰${bottomRule}`) + label(shownFooter) + border("─╯"))
  return framed.slice(0, height)
}

function positionFooter(selectedPosition: number, itemCount: number): string {
  return itemCount > 0 ? `${selectedPosition} of ${itemCount}` : ""
}

function entryPanel(
  title: string,
  entries: SidebarEntry[],
  selectedIndex: number,
  showsSelection: boolean,
  isFocused: boolean,
  width: number,
  height: number,
): string[] {
  const innerWidth = width - 2
  const scrollOffset = scrollOffsetFor(selectedIndex, entries.length, height - 2)
  const contentLines = entries.slice(scrollOffset, scrollOffset + height - 2).map((entry, visibleIndex) => {
    const line = fitToWidth(`${"  ".repeat(entry.depth)}${entry.name}`, innerWidth)
    return highlight(line, showsSelection && scrollOffset + visibleIndex === selectedIndex, isFocused)
  })
  const footer = positionFooter(selectedIndex + 1, entries.length)
  return framePanel({ title, footer, width, height, isFocused, contentLines })
}

const SHORTEST_TITLE_WIDTH = 8

function sectionLine(name: string, width: number): string {
  const shownName = truncateToWidth(name, width)
  const ruleWidth = width - displayWidth(shownName) - 1
  const rule = ruleWidth > 0 ? ` ${style.dim("─".repeat(ruleWidth))}` : " ".repeat(ruleWidth + 1)
  return style.bold(style.cyan(shownName)) + rule
}

type TaskLineOptions = {
  width: number
  todayDate: string
  claudeStatuses: ClaudeStatuses
  subtaskCount: number
  isExpanded: boolean
  showsDisclosure: boolean
}

function disclosureMarker({ subtaskCount, isExpanded, showsDisclosure }: TaskLineOptions): string {
  if (!showsDisclosure) return ""
  if (subtaskCount === 0) return "  "
  return isExpanded ? "▾ " : "▸ "
}

// The trailing labels give way, last one first, before the title gets too short to read.
function taskLine(row: TaskRow, options: TaskLineOptions): string {
  const { width, todayDate, claudeStatuses, subtaskCount, isExpanded } = options
  if (row.kind === "section") return sectionLine(row.name, width)
  const { task, depth, projectName } = row
  const indent = "  ".repeat(Math.min(depth, Math.floor(width / 6))) + disclosureMarker(options)
  const identity = (text: string) => text
  const claudeStatus = claudeStatuses[task.id]
  const claude = claudeStatus && claudeLabel(claudeStatus)
  const isCollapsed = subtaskCount > 0 && !isExpanded
  const candidateLabels = [
    isCollapsed && { text: `${subtaskCount} ${subtaskCount === 1 ? "subtask" : "subtasks"}`, color: style.dim },
    claude && { text: claude.text, color: claude.color },
    task.due && { text: dueLabel(task.due, todayDate), color: colorOfDue(task.due, todayDate) },
    projectName && { text: truncateToWidth(projectName, Math.floor(width * 0.25)), color: style.cyan },
  ].filter((label) => !!label)

  let titleWidth = width - displayWidth(indent) - 2
  let trailing = ""
  for (const label of candidateLabels) {
    const labelWidth = displayWidth(label.text) + 2
    if (titleWidth - labelWidth < SHORTEST_TITLE_WIDTH) break
    titleWidth -= labelWidth
    trailing += `  ${(label.color ?? identity)(label.text)}`
  }
  const title = fitToWidth(plainText(task.content), Math.max(0, titleWidth)).replace(/`[^`]+`/g, style.cyan)
  return `${indent}${priorityMarker(task.priority)} ${title}${trailing}`
}

function messageLines(message: string, hints: string[], width: number): string[] {
  const lines = wrapToWidth(message, width).map((line) => fitToWidth(line, width))
  for (const hint of hints) {
    for (const line of wrapToWidth(hint, width)) lines.push(style.dim(fitToWidth(line, width)))
  }
  return lines
}

function tasksPanel(state: ViewState, width: number, height: number): string[] {
  const innerWidth = width - 2
  const isFocused = state.focusedPanel === "tasks"
  const { taskList } = state
  let contentLines: string[]
  let footer = ""
  if (taskList.status === "loading") {
    contentLines = [style.dim(fitToWidth("Loading…", innerWidth))]
  } else if (taskList.status === "failed") {
    contentLines = messageLines(taskList.message, taskList.hints, innerWidth)
  } else if (taskList.rows.length === 0) {
    contentLines = [style.dim(fitToWidth("No tasks", innerWidth))]
  } else {
    const { rows } = taskList
    const shownIndexes = visibleRowIndexes(rows, state.expandedTaskIds)
    const showsDisclosure = rows.some((row) => row.kind === "task" && row.depth > 0)
    const scrollOffset = scrollOffsetFor(
      shownIndexes.indexOf(state.selectedTaskRowIndex),
      shownIndexes.length,
      height - 2,
    )
    contentLines = shownIndexes.slice(scrollOffset, scrollOffset + height - 2).map((rowIndex) => {
      const row = rows[rowIndex]!
      const line = taskLine(row, {
        width: innerWidth,
        todayDate: state.todayDate,
        claudeStatuses: state.claudeStatuses,
        subtaskCount: subtaskCountAt(rows, rowIndex),
        isExpanded: row.kind === "task" && state.expandedTaskIds.has(row.task.id),
        showsDisclosure,
      })
      return highlight(line, row.kind === "task" && rowIndex === state.selectedTaskRowIndex, isFocused)
    })
    const shownTaskIndexes = shownIndexes.filter((rowIndex) => rows[rowIndex]?.kind === "task")
    const selectedPosition = shownTaskIndexes.indexOf(state.selectedTaskRowIndex) + 1
    footer = positionFooter(selectedPosition, shownTaskIndexes.length)
  }
  return framePanel({ title: "[3]─Tasks", footer, width, height, isFocused, contentLines })
}

function detailLines(
  task: Task,
  projectName: string | undefined,
  claudeStatus: ClaudeStatus | undefined,
  subtaskCount: number,
  width: number,
  todayDate: string,
): string[] {
  const field = (name: string, value: string) =>
    style.cyan(`${name}: `) + fitToWidth(value, width - displayWidth(name) - 2)
  const lines = wrapToWidth(plainText(task.content), width).map((line) => style.bold(fitToWidth(line, width)))
  lines.push(" ".repeat(width))
  if (claudeStatus) {
    const note = claudeStatus.note ? `: ${plainText(claudeStatus.note)}` : ""
    lines.push(field("Claude", `${claudeLabel(claudeStatus).text}${note}`))
  }
  lines.push(field("Priority", priorityName(task.priority)))
  if (task.due) lines.push(field("Due", dueLabel(task.due, todayDate)))
  if (projectName) lines.push(field("Project", projectName))
  if (task.labels?.length) lines.push(field("Labels", task.labels.join(", ")))
  if (subtaskCount > 0) lines.push(field("Subtasks", String(subtaskCount)))
  if (task.description?.trim()) {
    lines.push(" ".repeat(width))
    const description = task.description.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    for (const line of wrapToWidth(description, width)) lines.push(fitToWidth(line, width))
  }
  return lines
}

function detailPanel(state: ViewState, width: number, height: number): string[] {
  const rows = state.taskList.status === "loaded" ? state.taskList.rows : []
  const selectedRow = rows[state.selectedTaskRowIndex]
  const contentLines =
    selectedRow?.kind === "task"
      ? detailLines(
          selectedRow.task,
          selectedRow.projectName,
          state.claudeStatuses[selectedRow.task.id],
          subtaskCountAt(rows, state.selectedTaskRowIndex),
          width - 2,
          state.todayDate,
        )
      : []
  return framePanel({ title: "Task", width, height, isFocused: false, contentLines })
}

function hintLine(statusMessage: string, width: number): string {
  const status = truncateToWidth(statusMessage, Math.floor(width / 2))
  const availableWidth = width - 3 - displayWidth(status)
  let hints = ""
  let hintsWidth = 0
  for (const [key, action] of KEY_HINTS) {
    const separator = hintsWidth > 0 ? "   " : ""
    const hintWidth = displayWidth(`${separator}${key} ${action}`)
    if (hintsWidth + hintWidth > availableWidth) break
    hints += `${separator}${style.bold(style.cyan(key))} ${style.dim(action)}`
    hintsWidth += hintWidth
  }
  const gap = " ".repeat(Math.max(0, width - 2 - hintsWidth - displayWidth(status)))
  return ` ${hints}${gap}${status} `
}

export function renderScreen(state: ViewState, width: number, height: number): string[] {
  if (width < 40 || height < 10) return [truncateToWidth("RexyTask needs a larger pane", width)]
  const panelsHeight = height - 1
  const leftWidth = Math.min(Math.max(Math.floor(width / 3), 24), 44)
  const rightWidth = width - leftWidth
  const viewsHeight = state.views.length + 2
  const detailHeight = panelsHeight >= 16 ? Math.max(8, Math.floor(panelsHeight * 0.3)) : 0

  const leftLines = [
    ...entryPanel(
      "[1]─Views",
      state.views,
      state.selectedViewIndex,
      state.activeSource === "views",
      state.focusedPanel === "views",
      leftWidth,
      viewsHeight,
    ),
    ...entryPanel(
      "[2]─Projects",
      state.projects,
      state.selectedProjectIndex,
      state.activeSource === "projects",
      state.focusedPanel === "projects",
      leftWidth,
      panelsHeight - viewsHeight,
    ),
  ]
  const rightLines = [
    ...tasksPanel(state, rightWidth, panelsHeight - detailHeight),
    ...detailPanel(state, rightWidth, detailHeight),
  ]
  return [
    ...leftLines.map((leftLine, lineIndex) => leftLine + (rightLines[lineIndex] ?? "")),
    hintLine(state.statusMessage, width),
  ]
}
