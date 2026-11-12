// Turns Todoist's flat lists into the ordered, indented rows of the two columns.
import type { Project, Section, Task } from "./todoist.ts"

export type SidebarEntry = {
  key: string
  name: string
  depth: number
  projectId?: string
}

export type TaskRow =
  | { kind: "section"; name: string }
  | { kind: "task"; task: Task; depth: number; projectName?: string }

export const TODAY_ENTRY: SidebarEntry = { key: "today", name: "Today", depth: 0 }

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

export function buildSidebarEntries(projects: Project[]): SidebarEntry[] {
  const projectEntries = flattenTree(projects).map(({ item: project, depth }) => ({
    key: `project:${project.id}`,
    name: project.name,
    depth,
    projectId: project.id,
  }))
  return [TODAY_ENTRY, ...projectEntries]
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

export function buildTodayTaskRows(tasks: Task[], projects: Project[]): TaskRow[] {
  const projectNamesById = new Map(projects.map((project) => [project.id, project.name]))
  return tasks.map((task) => ({
    kind: "task",
    task,
    depth: 0,
    projectName: projectNamesById.get(task.projectId),
  }))
}

// Returns the index of the next task row in that direction, skipping section headings.
export function moveTaskSelection(rows: TaskRow[], fromIndex: number, step: number): number {
  const direction = step < 0 ? -1 : 1
  let selectedIndex = fromIndex
  let remainingSteps = Math.abs(step)
  for (
    let candidateIndex = fromIndex + direction;
    candidateIndex >= 0 && candidateIndex < rows.length && remainingSteps > 0;
    candidateIndex += direction
  ) {
    if (rows[candidateIndex]?.kind !== "task") continue
    selectedIndex = candidateIndex
    remainingSteps -= 1
  }
  return selectedIndex
}

export function firstTaskIndex(rows: TaskRow[]): number {
  return rows.findIndex((row) => row.kind === "task")
}
