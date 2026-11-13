// Writes the selected task as a draft prompt and pastes it into the pane of Claude Code.
import type { TaskRow } from "./rows.ts"
import type { Task } from "./todoist.ts"
import { dueLabel } from "./view.ts"

export type AgentPane = {
  rexBinary: string
  sessionId: string
  blockId: string
}

export type DraftTools = {
  viewerBinary: string
  tdBinary: string
}

function subtasksOf(rows: TaskRow[], taskRowIndex: number): Task[] {
  const parentRow = rows[taskRowIndex]
  if (parentRow?.kind !== "task") return []
  const subtasks: Task[] = []
  for (const row of rows.slice(taskRowIndex + 1)) {
    if (row.kind !== "task" || row.depth <= parentRow.depth) break
    subtasks.push(row.task)
  }
  return subtasks
}

function quoted(path: string): string {
  return /^[\w./-]+$/.test(path) ? path : `"${path}"`
}

export function draftForTask(
  rows: TaskRow[],
  taskRowIndex: number,
  projectName: string | undefined,
  todayDate: string,
  tools: DraftTools,
): string | null {
  const row = rows[taskRowIndex]
  if (row?.kind !== "task") return null
  const { task } = row
  const lines = [`Todoist task: ${task.content} (id:${task.id})`]
  if (projectName) lines.push(`Project: ${projectName}`)
  if (task.due) lines.push(`Due: ${dueLabel(task.due, todayDate)}`)
  if (task.labels?.length) lines.push(`Labels: ${task.labels.join(", ")}`)
  if (task.description?.trim()) lines.push("", task.description.trim())
  const subtasks = subtasksOf(rows, taskRowIndex)
  if (subtasks.length > 0) {
    lines.push("", "Subtasks:", ...subtasks.map((subtask) => `- ${subtask.content} (id:${subtask.id})`))
  }
  const viewer = quoted(tools.viewerBinary)
  const td = quoted(tools.tdBinary)
  lines.push(
    "",
    `Report your progress on it to RexyTask: ${viewer} status ${task.id} working|done "short note".`,
    `Change it in Todoist with td, such as: ${td} task complete id:${task.id}, or ${td} comment add id:${task.id} --content "...".`,
    "",
    "",
  )
  return lines.join("\n")
}

export async function pasteIntoAgentPane(agentPane: AgentPane, text: string): Promise<void> {
  const request = JSON.stringify({
    block_id: agentPane.blockId,
    event: { type: "paste", payload: { text } },
  })
  const rexProcess = Bun.spawn(
    [agentPane.rexBinary, "api", "call", "--session", agentPane.sessionId, "block.event", "-"],
    { stdin: new Blob([request]), stdout: "ignore", stderr: "pipe" },
  )
  const [errorOutput, exitCode] = await Promise.all([
    new Response(rexProcess.stderr).text(),
    rexProcess.exited,
  ])
  if (exitCode !== 0) throw new Error(errorOutput.trim() || "rex could not reach the pane")
}
