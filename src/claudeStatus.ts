// What Claude Code reports about the tasks it was sent. The viewer and the
// "rexytask status" command share this file, so it survives closing the pane.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const REPORTED_STATES = ["working", "done"] as const
export type ClaudeState = "sent" | (typeof REPORTED_STATES)[number]

export type ClaudeStatus = {
  state: ClaudeState
  note?: string
  updatedAt: string
}

export type ClaudeStatuses = Record<string, ClaudeStatus>

const KEPT_DAYS = 14

export const statusDirectory = join(
  process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"),
  "rexytask",
)
export const STATUS_FILE_NAME = "claude-status.json"
const statusFile = join(statusDirectory, STATUS_FILE_NAME)

export function readClaudeStatuses(): ClaudeStatuses {
  try {
    return JSON.parse(readFileSync(statusFile, "utf8")) as ClaudeStatuses
  } catch {
    return {}
  }
}

export function taskIdOf(taskReference: string): string {
  return taskReference.replace(/^id:/, "")
}

// A null status forgets the task.
export function writeClaudeStatus(taskId: string, status: Omit<ClaudeStatus, "updatedAt"> | null) {
  const oldestKept = Date.now() - KEPT_DAYS * 86_400_000
  const statuses = Object.fromEntries(
    Object.entries(readClaudeStatuses()).filter(
      ([knownTaskId, known]) => knownTaskId !== taskId && Date.parse(known.updatedAt) >= oldestKept,
    ),
  )
  if (status) statuses[taskId] = { ...status, updatedAt: new Date().toISOString() }
  mkdirSync(statusDirectory, { recursive: true })
  const temporaryFile = `${statusFile}.${process.pid}.tmp`
  writeFileSync(temporaryFile, JSON.stringify(statuses, null, 2))
  renameSync(temporaryFile, statusFile)
}
