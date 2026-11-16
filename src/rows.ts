// Turns Todoist's flat lists into the ordered, indented rows of the two columns.
import type { Project, Section, Task } from "./todoist.ts"

export type DatedView = "today" | "upcoming"

export type SidebarEntry = {
  key: string
  name: string
  depth: number
  projectId?: string
  datedView?: DatedView
}

export type TaskRow =
  | { kind: "section"; name: string }
  | { kind: "task"; task: Task; depth: number; projectName?: string }

export const VIEW_ENTRIES: SidebarEntry[] = [
  { key: "today", name: "Today", depth: 0, datedView: "today" },
  { key: "upcoming", name: "Upcoming", depth: 0, datedView: "upcoming" },
]

type Nested = { id: string; parentId?: string | null; childOrder?: number }

function byChildOrder(first: Nested, second: Nested): number {
  return (first.childOrder ?? 0) - (second.childOrder ?? 0)
}

// An item whose parent is not in the list is shown at the top level.
function flattenTree<Item extends Nested>(items: Item[]): { item: Item; depth: number }[] {
  const knownIds = new Set(items.map((item) => item.id))
  const childrenByParentId = new Map<string, Item[]>()
  const topLevelItems: Item[] = []
  for (const item of items) {
    if (item.parentId && knownIds.has(item.parentId)) {
      const siblings = childrenByParentId.get(item.parentId) ?? []
      siblings.push(item)
      childrenByParentId.set(item.parentId, siblings)
    } else {
      topLevelItems.push(item)
    }
  }
  const flattened: { item: Item; depth: number }[] = []
  const visit = (item: Item, depth: number) => {
    flattened.push({ item, depth })
    for (const child of (childrenByParentId.get(item.id) ?? []).sort(byChildOrder)) visit(child, depth + 1)
  }
  for (const item of topLevelItems.sort(byChildOrder)) visit(item, 0)
  return flattened
}

export function buildProjectEntries(projects: Project[]): SidebarEntry[] {
  return flattenTree(projects).map(({ item: project, depth }) => ({
    key: `project:${project.id}`,
    name: project.name,
    depth,
    projectId: project.id,
  }))
}

function taskRowsOf(tasks: Task[]): TaskRow[] {
  return flattenTree(tasks).map(({ item: task, depth }) => ({ kind: "task", task, depth }))
}

export function buildProjectTaskRows(tasks: Task[], sections: Section[]): TaskRow[] {
  const knownSectionIds = new Set(sections.map((section) => section.id))
  const rows = taskRowsOf(
    tasks.filter((task) => !task.sectionId || !knownSectionIds.has(task.sectionId)),
  )
  const orderedSections = [...sections].sort(
    (first, second) => (first.sectionOrder ?? 0) - (second.sectionOrder ?? 0),
  )
  for (const section of orderedSections) {
    const sectionTasks = tasks.filter((task) => task.sectionId === section.id)
    if (sectionTasks.length === 0) continue
    rows.push({ kind: "section", name: section.name }, ...taskRowsOf(sectionTasks))
  }
  return rows
}

export function buildDatedTaskRows(tasks: Task[], projects: Project[]): TaskRow[] {
  const projectNamesById = new Map(projects.map((project) => [project.id, project.name]))
  return tasks.map((task) => ({
    kind: "task",
    task,
    depth: 0,
    projectName: projectNamesById.get(task.projectId),
  }))
}

export function subtaskCountAt(rows: TaskRow[], taskRowIndex: number): number {
  const parentRow = rows[taskRowIndex]
  if (parentRow?.kind !== "task") return 0
  let subtaskCount = 0
  for (let rowIndex = taskRowIndex + 1; rowIndex < rows.length; rowIndex++) {
    const followingRow = rows[rowIndex]
    if (followingRow?.kind !== "task" || followingRow.depth <= parentRow.depth) break
    subtaskCount += 1
  }
  return subtaskCount
}

// A subtask is shown only when every task above it in its tree is expanded.
export function visibleRowIndexes(rows: TaskRow[], expandedTaskIds: ReadonlySet<string>): number[] {
  const visibleIndexes: number[] = []
  let collapsedDepth: number | undefined
  rows.forEach((row, rowIndex) => {
    if (row.kind === "task" && collapsedDepth !== undefined && row.depth > collapsedDepth) return
    collapsedDepth = undefined
    visibleIndexes.push(rowIndex)
    const nextRow = rows[rowIndex + 1]
    const hasSubtasks = row.kind === "task" && nextRow?.kind === "task" && nextRow.depth > row.depth
    if (hasSubtasks && !expandedTaskIds.has(row.task.id)) collapsedDepth = row.depth
  })
  return visibleIndexes
}

// Returns the row itself when it is shown, or else the collapsed task that hides it.
export function shownRowIndex(rows: TaskRow[], rowIndex: number, expandedTaskIds: ReadonlySet<string>): number {
  return visibleRowIndexes(rows, expandedTaskIds).findLast((visibleIndex) => visibleIndex <= rowIndex) ?? -1
}

// Returns the index of the next shown task row in that direction, skipping section headings.
export function moveTaskSelection(
  rows: TaskRow[],
  fromIndex: number,
  step: number,
  expandedTaskIds: ReadonlySet<string>,
): number {
  const shownTaskIndexes = visibleRowIndexes(rows, expandedTaskIds).filter(
    (rowIndex) => rows[rowIndex]?.kind === "task",
  )
  if (shownTaskIndexes.length === 0) return fromIndex
  const currentPosition = step < 0
    ? shownTaskIndexes.findIndex((rowIndex) => rowIndex >= fromIndex)
    : shownTaskIndexes.findLastIndex((rowIndex) => rowIndex <= fromIndex)
  const startPosition = currentPosition >= 0 ? currentPosition : step < 0 ? shownTaskIndexes.length : -1
  const targetPosition = Math.min(shownTaskIndexes.length - 1, Math.max(0, startPosition + step))
  return shownTaskIndexes[targetPosition] ?? fromIndex
}

// Removes a task with the subtasks under it, and any section heading left with no tasks.
export function withoutTaskAt(rows: TaskRow[], taskRowIndex: number): TaskRow[] {
  const removedRow = rows[taskRowIndex]
  if (removedRow?.kind !== "task") return rows
  let endIndex = taskRowIndex + 1
  while (endIndex < rows.length) {
    const followingRow = rows[endIndex]
    if (followingRow?.kind !== "task" || followingRow.depth <= removedRow.depth) break
    endIndex += 1
  }
  const remainingRows = [...rows.slice(0, taskRowIndex), ...rows.slice(endIndex)]
  return remainingRows.filter(
    (row, rowIndex) => row.kind === "task" || remainingRows[rowIndex + 1]?.kind === "task",
  )
}

// Returns the task row at that index, or else the closest one after it, or else before it.
export function nearestTaskIndex(rows: TaskRow[], fromIndex: number): number {
  const isTask = (row: TaskRow) => row.kind === "task"
  const followingIndex = rows.findIndex((row, rowIndex) => rowIndex >= fromIndex && isTask(row))
  return followingIndex >= 0 ? followingIndex : rows.findLastIndex(isTask)
}

export function firstTaskIndex(rows: TaskRow[]): number {
  return rows.findIndex((row) => row.kind === "task")
}
