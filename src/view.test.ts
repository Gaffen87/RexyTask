import { expect, test } from "bun:test"
import { buildSidebarEntries, buildTodayTaskRows } from "./rows.ts"
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
    entries: buildSidebarEntries(projects),
    selectedEntryIndex: 0,
    taskList: {
      status: "loaded",
      rows: buildTodayTaskRows(
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
    focusedColumn: "tasks",
    statusMessage: "updated 14:02",
    todayDate: TODAY,
  }
  for (const width of [30, 47, 80, 133]) {
    const lines = renderScreen(state, width, 24)
    expect(lines).toHaveLength(24)
    for (const line of lines) expect(displayWidth(line)).toBe(width)
  }
})
