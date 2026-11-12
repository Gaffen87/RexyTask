// Reads Todoist data by running the official CLI, td, with --json.
// The ordering field, childOrder, is only in the output with --full.

export type Due = {
  date: string
  string?: string
  isRecurring?: boolean
}

export type Task = {
  id: string
  content: string
  description?: string
  priority: number
  due?: Due | null
  projectId: string
  sectionId?: string | null
  parentId?: string | null
  childOrder?: number
  labels?: string[]
}

export type Project = {
  id: string
  name: string
  parentId?: string | null
  childOrder?: number
}

export type Section = {
  id: string
  name: string
  projectId: string
  sectionOrder?: number
}

export class TodoistError extends Error {
  constructor(message: string, readonly code: string, readonly hints: string[] = []) {
    super(message)
  }
}

type ErrorPayload = { error?: { code?: string; message?: string; hints?: string[] } }

function errorFromOutput(output: string): TodoistError | null {
  try {
    const payload = JSON.parse(output) as ErrorPayload
    if (!payload.error) return null
    return new TodoistError(
      payload.error.message ?? "td failed",
      payload.error.code ?? "UNKNOWN",
      payload.error.hints ?? [],
    )
  } catch {
    return null
  }
}

export class TodoistClient {
  constructor(private readonly tdBinary: string) {}

  listProjects(): Promise<Project[]> {
    return this.list<Project>(["project", "list"])
  }

  listTodayTasks(): Promise<Task[]> {
    return this.list<Task>(["today"])
  }

  listProjectTasks(projectId: string): Promise<Task[]> {
    return this.list<Task>(["task", "list", "--project", `id:${projectId}`])
  }

  listSections(projectId: string): Promise<Section[]> {
    return this.list<Section>(["section", "list", "--project", `id:${projectId}`])
  }

  private async list<Item>(commandArguments: string[]): Promise<Item[]> {
    const output = await this.run([...commandArguments, "--all", "--json", "--full"])
    const payload = JSON.parse(output) as { results?: Item[] }
    return payload.results ?? []
  }

  private async run(commandArguments: string[]): Promise<string> {
    let tdProcess
    try {
      tdProcess = Bun.spawn([this.tdBinary, "--no-spinner", ...commandArguments], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      })
    } catch {
      throw new TodoistError(`Cannot run ${this.tdBinary}.`, "TD_MISSING", [
        "Install the Todoist CLI: brew install todoist-cli",
      ])
    }
    const [standardOutput, standardError, exitCode] = await Promise.all([
      new Response(tdProcess.stdout).text(),
      new Response(tdProcess.stderr).text(),
      tdProcess.exited,
    ])
    if (exitCode === 0) return standardOutput
    throw (
      errorFromOutput(standardOutput) ??
      errorFromOutput(standardError) ??
      new TodoistError(standardError.trim() || standardOutput.trim() || "td failed", "UNKNOWN")
    )
  }
}
