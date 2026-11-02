# Mapskill

A live map of your app for Claude Code. Mapskill scans your Next.js project, shows it as a map in your browser, stops Claude from editing files you have locked, and reminds Claude to reuse existing code instead of copying it.

Requires Node 22.12 or newer.

## What it does

- Starts a small background process on `127.0.0.1` when a Claude Code session begins.
- Blocks edits to files you have locked.
- Reminds Claude about new duplicates and other safe findings before it finishes its answer.
- Gives Claude the tools `map_overview`, `find_similar`, `node_details` and `turn_findings`.

Mapskill sends nothing over the network apart from `127.0.0.1`. It writes only to your project's `.mapskill/` folder.

## Use it from the command line

    npx mapskill scan <path-to-your-project>
    npx mapskill open

## Lock files

    npx mapskill lock <path>
    npx mapskill unlock <path>

You can also remove the line from `.mapskill/locks.json`.

## License

MIT
