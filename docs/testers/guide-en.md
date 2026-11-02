# Testing Mapskill: a guide for testers

Thank you for testing! Mapskill is a plugin for Claude Code. It shows your app as a map in your browser and helps Claude keep the code tidy.

The test runs for two weeks. Use Claude Code as you normally would, and open the map whenever you want to. You don't need to do anything special: we want to learn what happens in real use.

## 1. What you need

- **Claude Code**, which you already use.
- **Node.js** version 22.12 or newer. Node.js runs Mapskill in the background.
  - To check, type `node -v` in a terminal. `v22.12` or higher (for example `v22.14` or `v24`) means you are set.
  - Otherwise download the "LTS" version from [nodejs.org](https://nodejs.org) and install it. LTS means the stable release. Restart Claude Code afterwards.
- **A project** to work in. A Next.js app works best, but other JavaScript and TypeScript projects work too.

## 2. Install

Open Claude Code in your project folder and type:

    /plugin marketplace add Saccor/mapskill

Then:

    /plugin install mapskill@mapskill-marketplace

Finally type `/reload-plugins`, or start a new session.

**If this fails on Windows:** Claude Code tries SSH first, which needs a special key. Instead:
1. Close Claude Code.
2. Open PowerShell and type `setx CLAUDE_CODE_PLUGIN_PREFER_HTTPS 1`.
3. Reopen Claude Code and repeat the commands above.

## 3. Use it

| Type in Claude Code | What happens |
|---|---|
| `/mapskill:map` | The map of your project opens in your browser |
| `/mapskill:lock app/page.tsx` | The file is locked: Claude must ask you before changing it |
| `/mapskill:unlock app/page.tsx` | The lock is removed |
| `/mapskill:stats` | Shows how you have used Mapskill, as text you send us |

**The map** shows your app in zones: pages, server, building blocks, data and shared helpers. Click a part to see what it does.
- When Claude changes something, the part pulses.
- A number like `6/10` on a part means Mapskill found something to improve there, such as copied code.

**Goals:** pick what you are building in the goal picker at the top, for example "SaaS with login and payments".
- Missing parts appear as dashed "ghost" parts.
- Click one and press **Build with Claude**. A ready-made request then goes to Claude with your next message.

**While you work**, Mapskill does two things in the background:
- It reminds Claude when Claude copied code that already existed.
- It stops Claude from changing files you locked.

## 4. Send us your results

**On day 7 and day 14:** type `/mapskill:stats` in Claude Code and copy the text to us, for example by email or message.

The text holds only numbers: which days you used Claude with Mapskill, which days you opened the map, and how often you pressed its buttons. It contains no file names, no code and nothing about your project.

Please add a few words of your own too:
- What was good?
- What was confusing?
- When did you open the map, and why?

## 5. What is stored, and how to remove it

Mapskill sends nothing over the internet. It stores only on your computer:

- **`.mapskill/` in your project folder:** the map's state, your locks and your goal.
- **`.mapskill/usage.jsonl` in your home folder:** dates and which buttons were used.

**To remove Mapskill:**
1. Type `/plugin uninstall mapskill@mapskill-marketplace`.
2. Delete the folders above if you like.

## If something goes wrong

- **"node" not found:** install Node.js (step 1) and restart Claude Code.
- **The map does not open:** `/mapskill:map` shows an address. Paste it into your browser.
- **Anything else:** send us a screenshot. It is useful test data too.
