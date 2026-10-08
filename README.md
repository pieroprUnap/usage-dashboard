# usage-dashboard

A live side panel for [Claude Code](https://claude.com/claude-code) that shows what a session is doing while it works: usage, limits, tools, background jobs, tasks, an animated pet, and an agent map for sessions that run many subagents at once.

It is a Claude Code mod: a plugin of function hooks that draws a `Pane` beside the conversation.

## What it shows

| Section | Contents |
|---|---|
| **Header** | session title, working directory, model, effort and permission mode |
| **Pet** | a pixel-art slime whose mood follows the session: `idle`, `thinking`, `coding` (laptop), `searching` (magnifier), `reading` (book), `delegating` (mini agents), `puzzled` (a tool failed), `sleeping` (90 s idle), `happy` (press `p` to pet it) |
| **Usage** | tokens, cost, tool calls, session time |
| **Context** | context window fill, amber from 60 %, red from 85 % |
| **Limits** | 5-hour and weekly rate-limit windows with time to reset |
| **Tasks** | the session's task list: running, pending, done |
| **Background** | background shells and monitors, removed when their task-notification arrives (`clear` drops any leftover) |
| **Tools** | calls grouped by kind (built-in, mcp, plugins, subagents, skills); the tool in flight goes first with a pulsing dot |
| **Room** | an **agent map** with `main` in the center and every running subagent around it, linked by dotted lines that carry packets; a **participants** list; and a **live interaction stream** with timestamps |

The map packs agents on a grid around `main`, nearest first, growing up to 10 rows; past capacity the rest gather as a `+N` chip. Agents pop in when they start, bob and blink while they work, open their mouth when they talk, and burst into sparks when they finish.

The palette is neutral greys on a dark background; color is reserved for the pet, agent types and alerts.

## Install

Clone the repo anywhere, then point Claude Code at the folder.

```sh
git clone https://github.com/pieroprUnap/claude-code-usage-dashboard.git ~/.claude/mods/usage-dashboard
```

Load it in every session through `~/.claude/settings.json`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/mods/usage-dashboard"
  }
}
```

Or for a single session:

```sh
claude --plugin-dir ~/.claude/mods/usage-dashboard
```

The pane opens by itself on terminals 144 columns or wider. Otherwise run:

```
/dashboard
```

### Many subagents

Claude Code runs up to 20 subagents at once by default. To watch larger rooms, raise the limit in the same `env` block (it is read when Claude Code starts):

```json
"CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS": "50"
```

## Develop

```sh
claude plugin validate .
claude plugin test .
```

Files:

- `.claude-plugin/plugin.json`: manifest
- `hooks/hooks.json`: points at the hooks module
- `hooks/register.tsx`: the hooks and the pane
- `hooks/dashboard.test.ts`: tests run by `claude plugin test`
- `types/index.d.ts`: the shape of the state the pane keeps

When the mod loads, Claude Code writes its own typings to `.claude-plugin/types/` (ignored by git); `tsconfig.json` extends them so `tsc -p .` type-checks the mod.

## Known limits

- **Mode** only appears when Claude Code passes the permission mode to mods; otherwise the header shows the configured default, or `—`.
- **Font size** cannot be changed per section: everything uses the terminal's font.

## License

MIT
