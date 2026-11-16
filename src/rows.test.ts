import { expect, test } from "bun:test"
import {
  buildProjectTaskRows,
  buildProjectEntries,
  moveTaskSelection,
  nearestTaskIndex,
  withoutTaskAt,
  type TaskRow,
} from "./rows.ts"
import type { Task } from "./todoist.ts"

function task(id: string, overrides: Partial<Task> = {}): Task {
  return { id, content: `Task ${id}`, priority: 1, projectId: "project", ...overrides }
}

test("child projects are nested under their parent", () => {
  const entries = buildProjectEntries([
    { id: "work", name: "Work" },
    { id: "home", name: "Home" },
    { id: "clients", name: "Clients", parentId: "work" },
  ])
  expect(entries.map((entry) => [entry.name, entry.depth])).toEqual([
    ["Work", 0],
    ["Clients", 1],
    ["Home", 0],
  ])
})

test("project rows put unsectioned tasks first, then sections in order with subtasks nested", () => {
  const rows = buildProjectTaskRows(
    [
      task("later", { sectionId: "second" }),
      task("second child", { parentId: "loose", childOrder: 2 }),
      task("first child", { parentId: "loose", childOrder: 1 }),
      task("loose"),
      task("sooner", { sectionId: "first" }),
    ],
    [
      { id: "second", name: "Second", projectId: "project", sectionOrder: 2 },
      { id: "first", name: "First", projectId: "project", sectionOrder: 1 },
      { id: "empty", name: "Empty", projectId: "project", sectionOrder: 3 },
    ],
  )
  expect(rows.map((row) => (row.kind === "section" ? row.name : `${row.task.id}:${row.depth}`))).toEqual([
    "loose:0",
    "first child:1",
    "second child:1",
    "First",
    "sooner:0",
    "Second",
    "later:0",
  ])
})

test("task selection skips section headings and stops at the ends", () => {
  const rows = buildProjectTaskRows(
    [task("one"), task("two", { sectionId: "section" })],
    [{ id: "section", name: "Section", projectId: "project" }],
  )
  expect(moveTaskSelection(rows, 0, 1)).toBe(2)
  expect(moveTaskSelection(rows, 2, 1)).toBe(2)
  expect(moveTaskSelection(rows, 2, -5)).toBe(0)
})

function taskRow(id: string, depth = 0): TaskRow {
  return { kind: "task", task: task(id), depth }
}

function rowNames(rows: TaskRow[]): string[] {
  return rows.map((row) => (row.kind === "task" ? row.task.id : `# ${row.name}`))
}

test("removing a task takes its subtasks and an emptied section heading with it", () => {
  const rows: TaskRow[] = [
    taskRow("loose"),
    { kind: "section", name: "First" },
    taskRow("parent"),
    taskRow("child", 1),
    taskRow("grandchild", 2),
    { kind: "section", name: "Second" },
    taskRow("last"),
  ]
  expect(rowNames(withoutTaskAt(rows, 2))).toEqual(["loose", "# Second", "last"])
  expect(rowNames(withoutTaskAt(rows, 3))).toEqual(["loose", "# First", "parent", "# Second", "last"])
  expect(rowNames(withoutTaskAt(rows, 6))).toEqual(["loose", "# First", "parent", "child", "grandchild"])
})

test("the selection lands on the next task after a removal, or the previous one at the end", () => {
  const rows: TaskRow[] = [taskRow("first"), { kind: "section", name: "Section" }, taskRow("second")]
  expect(nearestTaskIndex(rows, 1)).toBe(2)
  expect(nearestTaskIndex(rows, 3)).toBe(2)
  expect(nearestTaskIndex([], 0)).toBe(-1)
})
