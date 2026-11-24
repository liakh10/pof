# Proof of Funds MCP: config snippets

Three ways to give an agent the eight read-only POF tools (`check_proof_of_funds`, `get_certificates`, `list_certificates`,
`get_room`, `list_rooms`, `get_stats`, `get_log_proof`, `get_log_head`).

| client | file | notes |
|---|---|---|
| Claude Code, hosted | `mcp.json` (project scope, put it at the repo root as `.mcp.json`) | or one command: `claude mcp add --transport http proof-of-funds https://YOUR-POF-SITE/mcp` |
| Claude Desktop, local | `claude_desktop_config.json` | reads the chain through your own RPC; nothing of ours in the path. Clone the repo, point `args` at `mcp/stdio.js` |
| Claude Desktop, hosted | `claude_desktop_config.remote.json` | bridges the hosted Streamable HTTP endpoint through `mcp-remote` |

Claude Desktop keeps its config at `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or
`%APPDATA%\Claude\claude_desktop_config.json` (Windows). Merge the `proof-of-funds` entry into `mcpServers` and restart it.

Without an RPC key, the local server can read a deployed API instead: replace `SOLANA_RPC` with
`"POF_API": "https://YOUR-POF-SITE/v1"`.

Try: "Does @anon hold at least 1,000 SOL?", "List the live USDC certificates of tier 4 or more", "Is log entry 41 in the
signed log?"
