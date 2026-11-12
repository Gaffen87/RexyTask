// RexyTask: a read-only Todoist viewer for the terminal, on top of the td CLI.
import packageInfo from "../package.json"
import {
  buildProjectTaskRows,
  buildSidebarEntries,
  buildTodayTaskRows,
  firstTaskIndex,
  moveTaskSelection,
  TODAY_ENTRY,
  type SidebarEntry,
} from "./rows.ts"
import { TodoistClient, TodoistError, type Project } from "./todoist.ts"
import { localDateOf, renderScreen, type Column, type TaskListState } from "./view.ts"

const ENTER_SCREEN = "\x1b[?1049h\x1b[?25l"
const LEAVE_SCREEN = "\x1b[?25h\x1b[?1049l"
const KEY_PATTERN = /\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Za-z]|[\s\S]/g
const SELECTION_SETTLE_MILLISECONDS = 150

const commandArguments = process.argv.slice(2)
if (commandArguments.includes("--version")) {
  console.log(packageInfo.version)
  process.exit(0)
}
if (!process.stdout.isTTY || !process.stdin.isTTY) {
  console.error("rexytask needs a terminal")
  process.exit(1)
}
const tdFlagIndex = commandArguments.indexOf("--td")
const tdBinary =
  (tdFlagIndex >= 0 && commandArguments[tdFlagIndex + 1]) || process.env.REXYTASK_TD || "td"
const todoist = new TodoistClient(tdBinary)

let projects: Project[] = []
let entries: SidebarEntry[] = [TODAY_ENTRY]
let selectedEntryIndex = 0
let focusedColumn: Column = "projects"
let statusMessage = ""
let refreshGeneration = 0
let selectionSettleTimer: ReturnType<typeof setTimeout> | undefined
const taskListsByEntryKey = new Map<string, TaskListState>()
const selectedTaskRowByEntryKey = new Map<string, number>()

function selectedEntry(): SidebarEntry {
  return entries[selectedEntryIndex] ?? TODAY_ENTRY
}

function selectedTaskList(): TaskListState {
  return taskListsByEntryKey.get(selectedEntry().key) ?? { status: "loading" }
}

function render() {
  const lines = renderScreen(
    {
      entries,
      selectedEntryIndex,
      taskList: selectedTaskList(),
      selectedTaskRowIndex: selectedTaskRowByEntryKey.get(selectedEntry().key) ?? -1,
      focusedColumn,
      statusMessage,
      todayDate: localDateOf(new Date()),
    },
    process.stdout.columns,
    process.stdout.rows,
  )
  process.stdout.write(`\x1b[?2026h\x1b[H\x1b[2J${lines.join("\r\n")}\x1b[?2026l`)
}

function failedState(error: unknown): TaskListState {
  if (error instanceof TodoistError) {
    const hints = error.code === "NO_TOKEN"
      ? ["Sign in once in a terminal: td auth login --read-only", "Then press r here."]
      : error.hints
    return { status: "failed", message: error.message, hints }
  }
  return { status: "failed", message: String(error), hints: [] }
}

async function loadTaskList(entry: SidebarEntry, projectsLoading?: Promise<void>) {
  const generation = refreshGeneration
  taskListsByEntryKey.set(entry.key, { status: "loading" })
  render()
  let taskList: TaskListState
  try {
    if (entry.projectId) {
      const [tasks, sections] = await Promise.all([
        todoist.listProjectTasks(entry.projectId),
        todoist.listSections(entry.projectId),
      ])
      taskList = { status: "loaded", rows: buildProjectTaskRows(tasks, sections) }
    } else {
      const [tasks] = await Promise.all([todoist.listTodayTasks(), projectsLoading])
      taskList = { status: "loaded", rows: buildTodayTaskRows(tasks, projects) }
    }
  } catch (error) {
    taskList = failedState(error)
  }
  if (generation !== refreshGeneration) return
  taskListsByEntryKey.set(entry.key, taskList)
  if (taskList.status === "loaded") {
    const previousIndex = selectedTaskRowByEntryKey.get(entry.key) ?? -1
    const stillATask = taskList.rows[previousIndex]?.kind === "task"
    selectedTaskRowByEntryKey.set(entry.key, stillATask ? previousIndex : firstTaskIndex(taskList.rows))
    if (firstTaskIndex(taskList.rows) < 0 && entry.key === selectedEntry().key) focusedColumn = "projects"
  } else if (entry.key === selectedEntry().key) {
    focusedColumn = "projects"
  }
  render()
}

async function loadProjects() {
  const generation = refreshGeneration
  const previouslySelectedKey = selectedEntry().key
  try {
    const loadedProjects = await todoist.listProjects()
    if (generation !== refreshGeneration) return
    projects = loadedProjects
    entries = buildSidebarEntries(projects)
    selectedEntryIndex = Math.max(0, entries.findIndex((entry) => entry.key === previouslySelectedKey))
    statusMessage = `updated ${new Date().toTimeString().slice(0, 5)}`
  } catch (error) {
    if (generation !== refreshGeneration) return
    statusMessage = "could not load projects"
  }
  render()
}

function refresh() {
  refreshGeneration += 1
  taskListsByEntryKey.clear()
  statusMessage = "loading…"
  const projectsLoading = loadProjects()
  void loadTaskList(TODAY_ENTRY, projectsLoading)
  projectsLoading.then(() => {
    if (selectedEntry().projectId) void loadTaskList(selectedEntry())
  })
}

function loadSelectedEntryWhenSettled() {
  clearTimeout(selectionSettleTimer)
  if (taskListsByEntryKey.has(selectedEntry().key)) return
  selectionSettleTimer = setTimeout(() => {
    if (!taskListsByEntryKey.has(selectedEntry().key)) void loadTaskList(selectedEntry())
  }, SELECTION_SETTLE_MILLISECONDS)
}

function moveSelection(step: number) {
  if (focusedColumn === "projects") {
    selectedEntryIndex = Math.min(entries.length - 1, Math.max(0, selectedEntryIndex + step))
    loadSelectedEntryWhenSettled()
    return
  }
  const taskList = selectedTaskList()
  if (taskList.status !== "loaded") return
  const entryKey = selectedEntry().key
  const currentIndex = selectedTaskRowByEntryKey.get(entryKey) ?? firstTaskIndex(taskList.rows)
  selectedTaskRowByEntryKey.set(entryKey, moveTaskSelection(taskList.rows, currentIndex, step))
}

function focusTasks() {
  const taskList = selectedTaskList()
  if (taskList.status === "loaded" && firstTaskIndex(taskList.rows) >= 0) focusedColumn = "tasks"
}

function quit() {
  process.stdout.write(LEAVE_SCREEN)
  process.stdin.setRawMode(false)
  process.exit(0)
}

function handleKey(key: string) {
  const pageStep = Math.max(1, process.stdout.rows - 4)
  switch (key) {
    case "q":
    case "\x03":
      return quit()
    case "j":
    case "\x1b[B":
    case "\x1bOB":
      return moveSelection(1)
    case "k":
    case "\x1b[A":
    case "\x1bOA":
      return moveSelection(-1)
    case "\x1b[6~":
      return moveSelection(pageStep)
    case "\x1b[5~":
      return moveSelection(-pageStep)
    case "g":
      return moveSelection(-Number.MAX_SAFE_INTEGER)
    case "G":
      return moveSelection(Number.MAX_SAFE_INTEGER)
    case "l":
    case "\r":
    case "\x1b[C":
    case "\x1bOC":
      return focusTasks()
    case "h":
    case "\x1b[D":
    case "\x1bOD":
      focusedColumn = "projects"
      return
    case "\t":
      if (focusedColumn === "projects") focusTasks()
      else focusedColumn = "projects"
      return
    case "r":
      return refresh()
  }
}

process.stdout.write(ENTER_SCREEN)
process.stdin.setRawMode(true)
process.stdin.resume()
process.stdin.on("data", (chunk: Buffer) => {
  for (const key of chunk.toString("utf8").match(KEY_PATTERN) ?? []) handleKey(key)
  render()
})
process.stdout.on("resize", render)
process.on("SIGTERM", quit)
process.on("SIGHUP", quit)
refresh()
