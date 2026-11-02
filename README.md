# Mapskill

A live map of your app for beginners who build with Claude Code. Mapskill shows the project as zones (pages, server, building blocks, data, shared helpers) and does three things for Claude:

- stops Claude from editing parts you locked
- reminds Claude to reuse code instead of copying it
- shows what is still missing for the goal you picked

**For testers:** [docs/testers/guide-en.md](docs/testers/guide-en.md) · [svenska](docs/testers/guide-sv.md)

**Install in Claude Code** (needs Node.js 22.12+):

    /plugin marketplace add Saccor/mapskill
    /plugin install mapskill@mapskill-marketplace

## Development

    pnpm install
    pnpm test            # unit and integration tests
    pnpm typecheck
    pnpm test:e2e        # map view in Edge (Playwright)
    pnpm build:release   # release/mapskill: the npm package, which is also the plugin
    pnpm test:release    # packs, installs and times the package

Packages:

- `packages/core`: analysis
- `packages/cli`: CLI, background daemon, hooks and MCP server
- `packages/ui`: the map view
- `plugin`: the Claude Code plugin's sources

Design and plans are in [docs/superpowers](docs/superpowers). Release steps are in [docs/release-checklist.md](docs/release-checklist.md).

## License

MIT
