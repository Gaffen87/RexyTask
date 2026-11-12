#!/bin/sh
# Builds the task viewer, installs its toggle into Rex's config directory, and reloads Rex.
set -eu

plugin_dir=$(cd -- "$(dirname -- "$0")" && pwd)
init_file=${REX_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/rex/init.lua}
config_dir=$(dirname -- "$init_file")
settings_file=$config_dir/rexytask.lua
toggle_file=$config_dir/rexytask_toggle.lua
require_line='require("rexytask")'

td_bin=${TD_BIN:-$(command -v td || true)}
if [ -z "$td_bin" ]; then
  echo "td is not on PATH. Install it (brew install todoist-cli) or set TD_BIN." >&2
  exit 1
fi

rexytask_bin=${REXYTASK_BIN:-$plugin_dir/bin/rexytask}
if [ -z "${REXYTASK_BIN:-}" ]; then
  if command -v bun >/dev/null 2>&1; then
    (cd "$plugin_dir" && bun build src/main.ts --compile --outfile bin/rexytask >/dev/null)
    echo "built $rexytask_bin"
  elif [ ! -x "$rexytask_bin" ]; then
    echo "bun is not on PATH, so the viewer cannot be built. Install it (brew install bun)." >&2
    exit 1
  fi
fi

lua_quoted() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

mkdir -p "$config_dir"

{
  echo "-- install.sh of RexyTask writes this file. Do not edit it. Your settings are in rexytask.lua."
  echo "local REXYTASK_BIN = \"$(lua_quoted "$rexytask_bin")\""
  echo "local TD_BIN = \"$(lua_quoted "$td_bin")\""
  echo
  cat "$plugin_dir/lua/rexytask_toggle.lua"
} > "$toggle_file"
echo "wrote $toggle_file"

if [ -e "$settings_file" ]; then
  echo "kept your settings in $settings_file"
else
  cp "$plugin_dir/lua/rexytask.lua" "$settings_file"
  echo "wrote $settings_file with your settings"
fi

if ! grep -qF "$require_line" "$init_file" 2>/dev/null; then
  if [ -s "$init_file" ] && [ -n "$(tail -c 1 "$init_file")" ]; then
    echo >> "$init_file"
  fi
  echo "$require_line" >> "$init_file"
  echo "added $require_line to $init_file"
fi

if rex config reload >/dev/null 2>&1; then
  echo "reloaded Rex's config"
else
  echo "reload Rex's config yourself: rex config reload" >&2
fi
if ! "$td_bin" auth status >/dev/null 2>&1; then
  echo "sign in to Todoist once: td auth login --read-only"
fi
echo "press shift+cmd+t, or run \"Toggle Todoist tasks\" from the command palette"
