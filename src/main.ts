// RexyTask: a read-only Todoist viewer for the terminal, on top of the td CLI.
import { mkdirSync, watch } from "node:fs"
import packageInfo from "../package.json"
import { draftForTask, pasteIntoAgentPane, type AgentPane } from "./claudeDraft.ts"
import {
  readClaudeStatuses,
  REPORTED_STATES,
  STATUS_FILE_NAME,
  statusDirectory,
  taskIdOf,
  writeClaudeStatus,
  type ClaudeState,
} from "./claudeStatus.ts"
import {
  buildDatedTaskRows,
  buildProjectEntries,
  buildProjectTaskRows,
  firstTaskIndex,
  moveTaskSelection,
  VIEW_ENTRIES,
  type SidebarEntry,
} from "./rows.ts"
import { TodoistClient, TodoistError, type Project } from "./todoist.ts"
import { localDateOf, renderScreen, type Panel, type SourcePanel, type TaskListState } from "./view.ts"

const ENTER_SCREEN = "\x1b[?1049h\x1b[?25l"
const LEAVE_SCREEN = "\x1b[?25h\x1b[?1049l"
const KEY_PATTERN = /\x1b\[[0-9;]*[A-Za-z~]|\x1bO[A-Za-z]|[\s\S]/g
const SELECTION_SETTLE_MILLISECONDS = 150
const STATUS_SETTLE_MILLISECONDS = 300
const PANEL_ORDER: Panel[] = ["views", "projects", "tasks"]

const commandArguments = process.argv.slice(2)
if (commandArguments.includes("--version")) {
  console.log(packageInfo.version)
  process.exit(0)
}
if (commandArguments[0] === "status") {
  const [, taskReference, state, ...noteWords] = commandArguments
  const isReported = (REPORTED_STATES as readonly string[]).includes(state ?? "")
  if (!taskReference || (!isReported && state !== "clear")) {
    console.error('usage: rexytask status <task-id> working|done|clear ["short note"]')
    process.exit(2)
  }
  const note = noteWords.join(" ").trim() || undefined
  writeClaudeStatus(taskIdOf(taskReference), isReported ? { state: state as ClaudeState, note } : null)
  process.exit(0)
}
if (!process.stdout.isTTY || !process.stdin.isTTY) {
  console.error("rexytask needs a terminal")
  process.exit(1)
}

function optionValue(optionName: string): string | undefined {
  const optionIndex = commandArguments.indexOf(optionName)
  return optionIndex >= 0 ? commandArguments[optionIndex + 1] : undefined
}

const tdBinary = optionValue("--td") || process.env.REXYTASK_TD || "td"
const todoist = new TodoistClient(tdBinary)
const agentSessionId = optionValue("--session")
const agentBlockId = optionValue("--agent")
const agentPane: AgentPane | null =
  agentSessionId && agentBlockId
    ? { rexBinary: optionValue("--rex") || "rex", sessionId: agentSessionId, blockId: agentBlockId }
    : null
const closesAfterSend = commandArguments.includes("--close-after-send")

let projects: Project[] = []
let projectEntries: SidebarEntry[] = []
let projectsLoading: Promise<void> = Promise.resolve()
let selectedViewIndex = 0
let selectedProjectIndex = 0
let activeSource: SourcePanel = "views"
let focusedPanel: Panel = "views"
let statusMessage = ""
let claudeStatuses = readClaudeStatuses()
let statusSettleTimer: ReturnType<typeof setTimeout> | undefined
let refreshGeneration = 0
let selectionSettleTimer: ReturnType<typeof setTimeout> | undefined
const taskListsByEntryKey = new Map<string, TaskListState>()
const selectedTaskRowByEntryKey = new Map<string, number>()

function activeEntry(): SidebarEntry | undefined {
  return activeSource === "views" ? VIEW_ENTRIES[selectedViewIndex] : projectEntries[selectedProjectIndex]
}

function activeTaskList(): TaskListState {
  const entry = activeEntry()
  if (!entry) return { status: "loaded", rows: [] }
  return taskListsByEntryKey.get(entry.key) ?? { status: "loading" }
}

function render() {
  const lines = renderScreen(
    {
      views: VIEW_ENTRIES,
      projects: projectEntries,
      selectedViewIndex,
      selectedProjectIndex,
      activeSource,
      focusedPanel,
      taskList: activeTaskList(),
      selectedTaskRowIndex: selectedTaskRowByEntryKey.get(activeEntry()?.key ?? "") ?? -1,
      claudeStatuses,
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

async function fetchTaskList(entry: SidebarEntry): Promise<TaskListState> {
  if (entry.projectId) {
    const [tasks, sections] = await Promise.all([
      todoist.listProjectTasks(entry.projectId),
      todoist.listSections(entry.projectId),
    ])
    return { status: "loaded", rows: buildProjectTaskRows(tasks, sections) }
  }
  const datedTasks = entry.datedView === "upcoming" ? todoist.listUpcomingTasks() : todoist.listTodayTasks()
  const [tasks] = await Promise.all([datedTasks, projectsLoading])
  return { status: "loaded", rows: buildDatedTaskRows(tasks, projects) }
}

async function loadTaskList(entry: SidebarEntry) {
  const generation = refreshGeneration
  if (!taskListsByEntryKey.has(entry.key)) taskListsByEntryKey.set(entry.key, { status: "loading" })
  render()
  const taskList = await fetchTaskList(entry).catch(failedState)
  if (generation !== refreshGeneration) return
  taskListsByEntryKey.set(entry.key, taskList)
  if (taskList.status === "loaded") {
    const previousIndex = selectedTaskRowByEntryKey.get(entry.key) ?? -1
    const stillATask = taskList.rows[previousIndex]?.kind === "task"
    selectedTaskRowByEntryKey.set(entry.key, stillATask ? previousIndex : firstTaskIndex(taskList.rows))
  }
  render()
}

async function loadProjects() {
  const generation = refreshGeneration
  const previouslySelectedKey = projectEntries[selectedProjectIndex]?.key
  try {
    const loadedProjects = await todoist.listProjects()
    if (generation !== refreshGeneration) return
    projects = loadedProjects
    projectEntries = buildProjectEntries(projects)
    selectedProjectIndex = Math.max(0, projectEntries.findIndex((entry) => entry.key === previouslySelectedKey))
    statusMessage = `updated ${new Date().toTimeString().slice(0, 5)}`
  } catch {
    if (generation !== refreshGeneration) return
    statusMessage = "could not load projects"
  }
  render()
}

function loadActiveEntryIfMissing() {
  const entry = activeEntry()
  if (entry && !taskListsByEntryKey.has(entry.key)) void loadTaskList(entry)
}

function refresh() {
  refreshGeneration += 1
  taskListsByEntryKey.clear()
  statusMessage = "loading…"
  projectsLoading = loadProjects()
  if (activeSource === "views") loadActiveEntryIfMissing()
  else void projectsLoading.then(loadActiveEntryIfMissing)
}

// Reloads behind the rows on screen, so a change made by Claude does not blank the list.
function refreshQuietly() {
  refreshGeneration += 1
  const entry = activeEntry()
  for (const entryKey of [...taskListsByEntryKey.keys()]) {
    if (entryKey !== entry?.key) taskListsByEntryKey.delete(entryKey)
  }
  projectsLoading = loadProjects()
  if (entry) void loadTaskList(entry)
}

function watchClaudeStatuses() {
  mkdirSync(statusDirectory, { recursive: true })
  watch(statusDirectory, (_change, fileName) => {
    if (fileName !== STATUS_FILE_NAME) return
    clearTimeout(statusSettleTimer)
    statusSettleTimer = setTimeout(() => {
      claudeStatuses = readClaudeStatuses()
      refreshQuietly()
    }, STATUS_SETTLE_MILLISECONDS)
  })
}

async function sendSelectedTaskToClaude() {
  const entry = activeEntry()
  const taskList = activeTaskList()
  if (!entry || taskList.status !== "loaded") return
  const taskRowIndex = selectedTaskRowByEntryKey.get(entry.key) ?? -1
  const row = taskList.rows[taskRowIndex]
  if (row?.kind !== "task") return
  if (!agentPane) {
    statusMessage = "no Claude pane: open RexyTask with its key in Rex"
    return
  }
  const projectName = row.projectName ?? (entry.projectId ? entry.name : undefined)
  const draft = draftForTask(taskList.rows, taskRowIndex, projectName, localDateOf(new Date()), {
    viewerBinary: process.execPath,
    tdBinary,
  })
  if (!draft) return
  try {
    await pasteIntoAgentPane(agentPane, draft)
  } catch (error) {
    statusMessage = `could not send: ${error instanceof Error ? error.message : String(error)}`
    return render()
  }
  writeClaudeStatus(row.task.id, { state: "sent" })
  claudeStatuses = readClaudeStatuses()
  if (closesAfterSend) return quit()
  statusMessage = "sent to Claude as a draft"
  render()
}

function loadActiveEntryWhenSettled() {
  clearTimeout(selectionSettleTimer)
  selectionSettleTimer = setTimeout(loadActiveEntryIfMissing, SELECTION_SETTLE_MILLISECONDS)
}

function clampIndex(index: number, itemCount: number): number {
  return Math.min(Math.max(0, itemCount - 1), Math.max(0, index))
}

function moveSelection(step: number) {
  if (focusedPanel === "views") {
    selectedViewIndex = clampIndex(selectedViewIndex + step, VIEW_ENTRIES.length)
    return loadActiveEntryWhenSettled()
  }
  if (focusedPanel === "projects") {
    selectedProjectIndex = clampIndex(selectedProjectIndex + step, projectEntries.length)
    return loadActiveEntryWhenSettled()
  }
  const taskList = activeTaskList()
  const entry = activeEntry()
  if (taskList.status !== "loaded" || !entry) return
  const currentIndex = selectedTaskRowByEntryKey.get(entry.key) ?? firstTaskIndex(taskList.rows)
  selectedTaskRowByEntryKey.set(entry.key, moveTaskSelection(taskList.rows, currentIndex, step))
}

function focusPanel(panel: Panel) {
  focusedPanel = panel
  if (panel === "tasks") return
  activeSource = panel
  loadActiveEntryWhenSettled()
}

function focusNeighbourPanel(step: number) {
  const panelIndex = PANEL_ORDER.indexOf(focusedPanel) + step + PANEL_ORDER.length
  focusPanel(PANEL_ORDER[panelIndex % PANEL_ORDER.length] ?? "views")
}

function quit() {
  process.stdout.write(LEAVE_SCREEN)
  process.stdin.setRawMode(false)
  process.exit(0)
}

function handleKey(key: string) {
  const pageStep = Math.max(1, process.stdout.rows - 6)
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
    case "1":
      return focusPanel("views")
    case "2":
      return focusPanel("projects")
    case "3":
    case "\r":
      return focusPanel("tasks")
    case "\t":
    case "l":
    case "\x1b[C":
    case "\x1bOC":
      return focusNeighbourPanel(1)
    case "\x1b[Z":
    case "h":
    case "\x1b[D":
    case "\x1bOD":
      return focusNeighbourPanel(-1)
    case "s":
      return void sendSelectedTaskToClaude()
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
watchClaudeStatuses()
refresh()
