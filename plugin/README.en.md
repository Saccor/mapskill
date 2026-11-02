# Mapskill

A live map of your app for Claude Code. Mapskill scans your project and shows it as a map in your browser. It also:

- stops Claude from editing files you have locked
- reminds Claude to reuse existing code instead of copying it
- shows what is still missing for the goal you pick

Requires Node.js 22.12 or newer ([nodejs.org](https://nodejs.org)).

## Install in Claude Code

Run in Claude Code:

    /plugin install mapskill --marketplace Saccor/mapskill

Or as two steps:

    /plugin marketplace add Saccor/mapskill
    /plugin install mapskill@mapskill-marketplace

Then run `/reload-plugins`, or start a new session.

If adding the marketplace fails on Windows, set the environment variable `CLAUDE_CODE_PLUGIN_PREFER_HTTPS=1` and try again.

## Commands in Claude Code

- `/mapskill:map` opens the map of your project in your browser.
- `/mapskill:lock <file or folder>` locks it, so Claude must ask before changing it.
- `/mapskill:unlock <file or folder>` removes the lock.
- `/mapskill:stats` shows how you have used Mapskill. You can copy the text to whoever asked you to test it. Nothing is sent.

You can also remove a lock by deleting its line in `.mapskill/locks.json`.

## What it does in the background

Mapskill starts a small background process on `127.0.0.1` when a Claude Code session begins. It then:

- blocks edits to files you have locked
- reminds Claude about new duplicates and other safe findings before it finishes its answer
- gives Claude the tools `map_overview`, `find_similar`, `node_details`, `turn_findings` and `goal_gaps`

## Use it from the command line

Run these in your project folder:

    npx mapskill                 open the map for this folder
    npx mapskill scan            list findings in the terminal
    npx mapskill lock <path>
    npx mapskill unlock <path>
    npx mapskill stats
    npx mapskill --help

## Privacy

Mapskill sends nothing over the network apart from `127.0.0.1`. It writes in two places:

- **Your project's `.mapskill/` folder:** the map's state, your locks and your goal.
- **`~/.mapskill/usage.jsonl`:** a small local usage log. It holds only dates, event names and a short hash of the project folder, and never any paths, file names or code.

`mapskill stats` summarises the log. Delete the folder to remove it.

## License

MIT
