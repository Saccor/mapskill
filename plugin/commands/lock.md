---
description: Lock a file or folder so Claude must ask before changing it
argument-hint: <file or folder>
disable-model-invocation: true
allowed-tools: Bash(node *)
---

The user wants to lock these files or folders: $ARGUMENTS

If nothing was given, ask the user which file or folder, and wait for the answer.

For each path, run this command with the Bash tool from the project folder (one call per path, with the path relative to the project folder):

node "${CLAUDE_PLUGIN_ROOT}/dist/mapskill.mjs" lock "<path>"

Then confirm in one sentence what is now locked and what that means: Claude must ask before changing it. Answer in the user's language.
