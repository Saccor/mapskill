---
name: mapskill
description: Use in projects mapped by Mapskill (a beginner's live map of the app). Explains how to reuse existing code, respect parts the user locked, put new code in the right place, and answer findings from the Stop hook.
---

# Working in a project mapped by Mapskill

The user may be new to programming. They see the app as a map of pages, server routes, building blocks, data and shared helpers. Keep that map tidy.

- Before you create a new function, component or file, call `find_similar` (tool `mcp__plugin_mapskill_mapskill__find_similar`) with the name you plan and, if you have it, the code. If something fits, import and reuse it instead of writing a copy.
- Call `map_overview` to see the project's zones and where similar code already lives. Put new code where the project's structure says, not inside the file that happens to call it.
- If the user chose a goal in the Mapskill map, call `goal_gaps` before you suggest what to build next, and build missing parts where it suggests.
- Files the user locked in Mapskill must not be changed unless the user explicitly asks you to in this conversation. If an edit is refused because of a lock, tell the user which part is locked and ask.
- When the Stop hook lists Mapskill findings, fix the ones you agree with. For each one you leave, tell the user in one plain sentence why.
- When the user asks what a part of the map does, use `node_details` and answer in plain words. Answer in Swedish if the user writes Swedish. Avoid jargon, or explain it in a few words the first time.
- The user can type `/mapskill:map` to open the map, `/mapskill:lock <path>` and `/mapskill:unlock <path>` to lock or unlock a file or folder, and `/mapskill:stats` to see how Mapskill has been used. Point to these instead of terminal commands.
