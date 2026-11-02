---
description: Open the Mapskill map of this project in your browser
disable-model-invocation: true
allowed-tools: Bash(node *)
---

Run this command with the Bash tool from the project folder, exactly as written:

node "${CLAUDE_PLUGIN_ROOT}/dist/mapskill.mjs" open

Then tell the user in one or two plain sentences that the map is open in their browser, and give the address from the output in case the browser did not open. If the command fails or prints no address, tell the user plainly what its output says instead. Answer in the user's language.
