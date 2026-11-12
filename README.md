# RexyTask

View your [Todoist](https://www.todoist.com) projects and tasks in a [Rex](https://www.superlogical.com/rex) pane with one key. A sibling of [RexyGit](https://github.com/Gaffen87/RexyGit).

Press <kbd>Shift</kbd>+<kbd>Cmd</kbd>+<kbd>T</kbd> to open the viewer in a floating pane. Press it again to close it.

The viewer only reads. It gets its data from the official [Todoist CLI](https://github.com/Doist/todoist-cli), `td`.

## Install

You need [Bun](https://bun.sh) to build the viewer.

```sh
brew install todoist-cli
td auth login --read-only
./install.sh
```

The installer builds `bin/rexytask`, copies two Lua files into Rex's config directory (`~/.config/rex` by default), adds `require("rexytask")` to `init.lua`, and reloads Rex. Run it again after you pull an update, or after you move this folder or the `td` binary.

To remove everything: `./uninstall.sh`.

## Keys

| Key | Action |
| --- | --- |
| <kbd>↑</kbd> <kbd>↓</kbd> or <kbd>k</kbd> <kbd>j</kbd> | Move the selection |
| <kbd>Tab</kbd>, or <kbd>←</kbd> <kbd>→</kbd> or <kbd>h</kbd> <kbd>l</kbd> | Switch between projects and tasks |
| <kbd>g</kbd> <kbd>G</kbd> | Jump to the first or last row |
| <kbd>PgUp</kbd> <kbd>PgDn</kbd> | Move a page |
| <kbd>r</kbd> | Load everything again |
| <kbd>q</kbd> | Quit |

The left column lists **Today** and then your projects. The right column lists the tasks of the selected entry, grouped by section, with subtasks indented. The dot before a task shows its priority: red for p1, yellow for p2, blue for p3.

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
- `rexytask_toggle.lua` holds the action. The installer rewrites it on every run, with the paths of the viewer and of `td` at the top.
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
