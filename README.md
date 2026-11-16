# RexyTask

View your [Todoist](https://www.todoist.com) projects and tasks in a [Rex](https://www.superlogical.com/rex) pane with one key. A sibling of [RexyGit](https://github.com/Gaffen87/RexyGit).

Press <kbd>Shift</kbd>+<kbd>Cmd</kbd>+<kbd>T</kbd> to open the viewer in a floating pane. Press it again to close it.

The viewer gets its data from the official [Todoist CLI](https://github.com/Doist/todoist-cli), `td`, and only reads. It can hand a task to the [Claude Code](https://claude.com/claude-code) session in the pane you opened it from, and show what Claude reports back.

## Install

You need [Bun](https://bun.sh) to build the viewer.

```sh
brew install todoist-cli
td auth login
./install.sh
```

The installer builds `bin/rexytask`, copies two Lua files into Rex's config directory (`~/.config/rex` by default), adds `require("rexytask")` to `init.lua`, and reloads Rex. Run it again after you pull an update, or after you move this folder or the `td` binary.

Sign in with `td auth login --read-only` instead if Claude should not be able to change your tasks. You then cannot mark tasks as done from RexyTask either.

To remove everything: `./uninstall.sh`.

## Keys

The screen is laid out like [lazygit](https://github.com/jesseduffield/lazygit): numbered panels, with the focused one outlined in green.

| Key | Action |
| --- | --- |
| <kbd>↑</kbd> <kbd>↓</kbd> or <kbd>k</kbd> <kbd>j</kbd> | Move the selection |
| <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> | Jump to Views, Projects, or Tasks |
| <kbd>Tab</kbd>, or <kbd>←</kbd> <kbd>→</kbd> or <kbd>h</kbd> <kbd>l</kbd> | Go to the next or previous panel |
| <kbd>Enter</kbd> | Go to the tasks |
| <kbd>g</kbd> <kbd>G</kbd> | Jump to the first or last row |
| <kbd>PgUp</kbd> <kbd>PgDn</kbd> | Move a page |
| <kbd>d</kbd> | Mark the selected task as done, with its subtasks |
| <kbd>u</kbd> | Reopen the task you last marked as done |
| <kbd>s</kbd> | Send the selected task to Claude Code as a draft |
| <kbd>r</kbd> | Load everything again |
| <kbd>q</kbd> | Quit |

- **Views** lists Today and Upcoming (the next 7 days).
- **Projects** lists your projects.
- **Tasks** lists the tasks of the view or project you selected, grouped by section, with subtasks indented. The dot before a task shows its priority: red for p1, yellow for p2, cyan for p3.
- **Task** shows the selected task's full title, priority, due date, labels and description.

## Working with Claude Code

Open RexyTask from the pane where Claude Code runs, select a task, and press <kbd>s</kbd>.

- **To Claude**: the task's title, project, due date, description and subtasks are pasted into Claude's prompt as a draft. Nothing is submitted, so you can add your own words and press enter yourself. A floating or zoomed viewer closes after sending, because it covers Claude's pane. A split or tab stays open.
- **From Claude**: the draft tells Claude how to report back. The viewer then marks the task as `→ sent`, `⟳ working` or `✓ done`, with Claude's note in the Task panel:

  ```sh
  rexytask status <task-id> working "reading the code"
  rexytask status <task-id> done "fixed in the last commit"
  rexytask status <task-id> clear
  ```

- **Changes in Todoist**: the draft also names `td`, so Claude can complete the task or comment on it. The viewer reloads when Claude reports a status. This needs a sign-in with write access: `td auth login`.

The statuses are kept in `~/.local/state/rexytask/claude-status.json` for 14 days, so they are still there when you open the viewer again.

## Settings

Edit `~/.config/rex/rexytask.lua`, then run `rex config reload`.

| Setting | Default | Values |
| --- | --- | --- |
| `key` | `"shift+cmd+t"` | Any Rex key, or `false` for no key |
| `placement` | `"overlay"` | `overlay` (floating), `split`, `zoomed`, `tab` |
| `direction` | `"right"` | `right`, `down` (for `split` and `zoomed`) |
| `ratio` | `0.5` | The share of the split that the viewer gets, between 0 and 1 |

The action is also in the command palette as **Toggle Todoist tasks**, and takes a one-off placement:

```sh
rex do rexytask_toggle placement=split
```

## How it works

- `bin/rexytask` is a terminal app written in TypeScript and compiled with Bun. It runs `td ... --json` and draws the result. You can also run it on its own, outside Rex.
- `rexytask.lua` holds your settings. The installer never overwrites it.
- `rexytask_toggle.lua` holds the action. The installer rewrites it on every run, with the paths of the viewer, `td` and `rex` at the top.
- The toggle looks in the focused tab for a pane labelled `rexytask`. If it finds one, it closes it. Otherwise it opens a new one.

## Develop

```sh
bun install
bun test
bun run typecheck
bun run build
```

## License

[MIT](LICENSE)
