-- Settings of RexyTask. install.sh wrote this file and never overwrites it.
-- To change a setting, edit it, then run "rex config reload".
local settings = {
  -- key = "shift+cmd+t", -- the key of the toggle, or false for none
  -- placement = "overlay", -- overlay, split, zoomed, or tab
  -- direction = "right", -- of split and zoomed: right or down
  -- ratio = 0.5, -- the share of the split that RexyTask gets
}

local loaded, load_error = pcall(function() require("rexytask_toggle")(settings) end)
if not loaded then
  rex.action{ name = "rexytask_toggle", title = "Toggle Todoist tasks",
    run = function() error("RexyTask: " .. tostring(load_error), 0) end }
  local key = type(settings) == "table" and settings.key
  if key == nil then key = "shift+cmd+t" end
  if key then rex.bind(key, "rexytask_toggle") end
end
