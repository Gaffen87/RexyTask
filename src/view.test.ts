import { expect, test } from "bun:test"
import { buildDatedTaskRows, buildProjectEntries, buildProjectTaskRows, VIEW_ENTRIES } from "./rows.ts"
import { displayWidth, truncateToWidth } from "./text.ts"
import { dueLabel, renderScreen, scrollOffsetFor, type ViewState } from "./view.ts"

const TODAY = "2026-11-12"

test("due dates read relative to today", () => {
  expect(dueLabel({ date: "2026-11-12" }, TODAY)).toBe("Today")
  expect(dueLabel({ date: "2026-11-13T09:30:00" }, TODAY)).toBe("Tomorrow 09:30")
  expect(dueLabel({ date: "2026-11-03", isRecurring: true }, TODAY)).toBe("↻ 3 Nov")
  expect(dueLabel({ date: "2027-01-05" }, TODAY)).toBe("5 Jan 2027")
})

test("truncation counts wide characters as two columns", () => {
  expect(truncateToWidth("日本語のタスク", 7)).toBe("日本語…")
  expect(displayWidth(truncateToWidth("日本語のタスク", 7))).toBe(7)
})

test("the selected row stays in view", () => {
  expect(scrollOffsetFor(0, 100, 10)).toBe(0)
  expect(scrollOffsetFor(50, 100, 10)).toBe(45)
  expect(scrollOffsetFor(99, 100, 10)).toBe(90)
})

test("every line of the screen is exactly as wide as the terminal", () => {
  const projects = [{ id: "work", name: "Work 仕事" }]
  const state: ViewState = {
    views: VIEW_ENTRIES,
    projects: buildProjectEntries(projects),
    selectedViewIndex: 0,
    selectedProjectIndex: 0,
    activeSource: "views",
    focusedPanel: "tasks",
    taskList: {
      status: "loaded",
      rows: buildDatedTaskRows(
        [
          {
            id: "1",
            content: "Read the [td docs](https://example.com) 📚 and a very long title that will not fit",
            description: "Line one\nline two",
            priority: 4,
            due: { date: "2026-11-10", isRecurring: true },
            projectId: "work",
            labels: ["reading"],
          },
          { id: "2", content: "Short", priority: 1, projectId: "work" },
        ],
        projects,
      ),
    },
    selectedTaskRowIndex: 0,
    expandedTaskIds: new Set(),
    claudeStatuses: { "1": { state: "working", note: "reading 📚", updatedAt: "2026-11-12T10:00:00Z" } },
    statusMessage: "updated 14:02",
    todayDate: TODAY,
  }
  const nestedState: ViewState = {
    ...state,
    taskList: {
      status: "loaded",
      rows: buildProjectTaskRows(
        [
          { id: "parent", content: "Parent with `code` in a long title", priority: 1, projectId: "work" },
          { id: "child", content: "Child", priority: 2, projectId: "work", parentId: "parent" },
          { id: "sectioned", content: "Sectioned", priority: 1, projectId: "work", sectionId: "section" },
        ],
        [{ id: "section", name: "A section 仕事 with a long name", projectId: "work" }],
      ),
    },
  }
  const expandedState: ViewState = { ...nestedState, expandedTaskIds: new Set(["parent"]) }
  for (const screenState of [state, nestedState, expandedState]) {
    for (const [width, height] of [[40, 10], [47, 15], [80, 24], [133, 50]] as const) {
      const lines = renderScreen(screenState, width, height)
      expect(lines).toHaveLength(height)
      for (const line of lines) expect(displayWidth(line)).toBe(width)
    }
  }
  const collapsedScreen = renderScreen(nestedState, 80, 24).join("\n")
  expect(collapsedScreen).toContain("▸")
  expect(collapsedScreen).toContain("1 subtask")
  expect(collapsedScreen).not.toContain("Child")
  expect(renderScreen(expandedState, 80, 24).join("\n")).toContain("Child")
})
