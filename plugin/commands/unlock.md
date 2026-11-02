---
description: Unlock a file or folder that was locked with Mapskill
argument-hint: <file or folder>
disable-model-invocation: true
allowed-tools: Bash(node *)
---

The user wants to unlock these files or folders: $ARGUMENTS

If nothing was given, ask the user which file or folder, and wait for the answer.

For each path, run this command with the Bash tool from the project folder (one call per path, with the path relative to the project folder):

node "${CLAUDE_PLUGIN_ROOT}/dist/mapskill.mjs" unlock "<path>"

Then confirm in one sentence what is now unlocked and what that means: Claude may change it again without asking. Answer in the user's language.
