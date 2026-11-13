-- install.sh writes this code under lines that set REXYTASK_BIN, TD_BIN and REX_BIN, the
-- paths of the task viewer, the Todoist CLI and the Rex CLI.

local PLACEMENTS = { split = true, zoomed = true, tab = true, overlay = true }
local SPLIT_DIRECTIONS = { right = "horizontal", down = "vertical" }
local TERMINAL = "com.superlogical.terminal"
local PANE_LABEL = "rexytask"
local DEFAULT_KEY = "shift+cmd+t"

local function must(result, call_error)
  if call_error ~= nil then error(call_error, 0) end
  return result
end

local function window_of(blocks, block_id)
  for _, block in ipairs(blocks) do
    if block.block_id == block_id then return block.window_id end
  end
  return nil
end

local function open_task_panes(blocks, window_id)
  local pane_ids = {}
  for _, block in ipairs(blocks) do
    local in_window = window_id == nil or block.window_id == window_id
    if block.creator_name == TERMINAL and in_window and block.label == PANE_LABEL then
      table.insert(pane_ids, block.block_id)
    end
  end
  return pane_ids
end

-- Without this check a missing viewer closes the new pane before its error shows.
local function check_viewer_runs()
  local result, exec_error = rex.exec({ REXYTASK_BIN, "--version" }, { timeout = 5 })
  if result == nil then error("cannot run " .. REXYTASK_BIN .. ": " .. tostring(exec_error), 0) end
  if not result.ok then error((result.stderr:gsub("%s+$", "")), 0) end
end

-- The viewer pastes a task into the pane it was opened from, where Claude Code runs.
-- An overlay or a zoomed pane covers that pane, so the viewer closes after sending.
local function viewer_command(session_id, focused_block_id, placement)
  local command = { REXYTASK_BIN, "--td", TD_BIN, "--rex", REX_BIN }
  if session_id and focused_block_id then
    for _, argument in ipairs({ "--session", session_id, "--agent", focused_block_id }) do
      table.insert(command, argument)
    end
    if placement == "overlay" or placement == "zoomed" then
      table.insert(command, "--close-after-send")
    end
  end
  return command
end

local function open_tasks(session_id, focused_block_id, window_id, placement, direction, ratio)
  local pane = rex.layout.block{
    flavor = TERMINAL .. ".shell",
    label = PANE_LABEL,
    options = { command = viewer_command(session_id, focused_block_id, placement) },
  }
  if placement == "tab" then
    return must(rex.session.new_window{ window_label = PANE_LABEL, layout = pane })
  elseif placement == "overlay" then
    return must(rex.session.new_layer{
      window_id = window_id,
      bounds = { 0.04, 0.04, 0.92, 0.92 },
      layout = pane,
      focus = true,
    })
  end
  local split = must(rex.session.new_split{
    anchor_id = focused_block_id,
    direction = SPLIT_DIRECTIONS[direction],
    side = "after",
    ratio = 1 - ratio,
    focus = true,
    layout = pane,
  })
  if placement == "zoomed" then
    must(rex.session.zoom_block{ block_id = split.block_ids[1], zoom = true })
  end
  return split
end

return function(settings)
  if type(settings) ~= "table" then
    error("config: settings must be a table, as in: local settings = { }", 0)
  end
  local key = settings.key
  if key == nil then key = DEFAULT_KEY end
  local default_placement = settings.placement or "overlay"
  local direction = settings.direction or "right"
  local ratio = settings.ratio or 0.5
  if not PLACEMENTS[default_placement] then
    error("config: unknown placement " .. tostring(default_placement)
      .. "; use split, zoomed, tab, or overlay", 0)
  end
  if not SPLIT_DIRECTIONS[direction] then
    error("config: unknown direction " .. tostring(direction) .. "; use right or down", 0)
  end
  if type(ratio) ~= "number" or ratio <= 0 or ratio >= 1 then
    error("config: ratio must be a number between 0 and 1", 0)
  end

  rex.action{
    name = "rexytask_toggle",
    title = "Toggle Todoist tasks",
    description = "Open your Todoist projects and tasks, or close them",
    category = "RexyTask",
    keywords = "todoist tasks todo projects today td",
    args = { placement = "string?" },
    run = function(ctx, args)
      local placement = args.placement or default_placement
      if not PLACEMENTS[placement] then
        error("unknown placement " .. tostring(placement)
          .. "; use split, zoomed, tab, or overlay", 0)
      end
      local blocks = must(rex.session.list_blocks{}).blocks or {}
      local window_id = window_of(blocks, ctx.block_id)
      local open_pane_ids = open_task_panes(blocks, window_id)
      if #open_pane_ids == 0 then
        check_viewer_runs()
        return open_tasks(ctx.session_id, ctx.block_id, window_id, placement, direction, ratio)
      end
      for _, pane_id in ipairs(open_pane_ids) do
        must(rex.call("block.close", { session_id = ctx.session_id, block_id = pane_id }))
      end
      return { closed = open_pane_ids }
    end,
  }
  if key then rex.bind(key, "rexytask_toggle") end
end
