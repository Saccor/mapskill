# Mapskill

A live map of your app for Claude Code. Mapskill scans your Next.js project, shows it as a map in your browser, stops Claude from editing files you have locked, and reminds Claude to reuse existing code instead of copying it.

Requires Node 22.12 or newer.

## What it does

- Starts a small background process on `127.0.0.1` when a Claude Code session begins.
- Blocks edits to files you have locked.
- Reminds Claude about new duplicates and other safe findings before it finishes its answer.
- Gives Claude the tools `map_overview`, `find_similar`, `node_details` and `turn_findings`.

Mapskill sends nothing over the network apart from `127.0.0.1`. It writes only to your project's `.mapskill/` folder.

## Commands in Claude Code

- `/mapskill:map` opens the map of your project in your browser.
- `/mapskill:lock <file or folder>` locks it, so Claude must ask before changing it.
- `/mapskill:unlock <file or folder>` removes the lock.
- `/mapskill:stats` shows how Mapskill has been used, as a text you can copy to whoever asked you to test it. Nothing is sent.

You can also remove a lock by deleting its line in `.mapskill/locks.json`.

## Use it from the command line

    npx mapskill scan <path-to-your-project>
    npx mapskill open
    npx mapskill lock <path>
    npx mapskill unlock <path>

## License

MIT
