# Contributing to @asoc/mcp-server

Thank you for contributing to the A-SOC MCP Server!

## Development Setup

```bash
# Clone the repository
git clone https://github.com/asoc-trust/asoc-core.git
cd asoc-core/packages/mcp

# Install dependencies
npm install

# Run in development mode
npm run dev

# Build
npm run build
```

## Testing Your Changes

The MCP server exposes tools via the Model Context Protocol:

```bash
# 1. Start the server
npm run dev

# 2. Test with cURL
curl -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "is_agent_certified",
      "arguments": {"agentId": "agent-12345"}
    }
  }'
```

## Code Style

- Follow MCP specification (https://modelcontextprotocol.io)
- All tools should return JSON-serializable results
- Use Zod for input validation
- Keep demo data clearly separated from production logic

## What We're Looking For

- **New MCP tools**: e.g., `revoke_certification`, `get_audit_history`
- **Database integrations**: Replace in-memory registry with Postgres/Redis
- **Caching layer**: Speed up trust score calculations
- **Webhook support**: Real-time kill switch notifications

## Pull Request Guidelines

1. Add new tools to `src/server.ts`
2. Define schemas in `src/schemas.ts`
3. Update README.md with tool documentation
4. Test with both HTTP and stdio transports

## Architecture Notes

The MCP server is the **discovery layer** for A-SOC:
- `server.ts`: Tool definitions and handlers
- `schemas.ts`: Zod validation schemas
- `index.ts`: HTTP/stdio transport setup

Replace `seedDemoAgents()` with your database when productionizing.

## Questions?

Open an issue or reach out at https://github.com/asoc-trust/asoc-core/discussions
