# @asoc/mcp-server

MCP (Model Context Protocol) audit server for agent discovery and certification.

## Installation

```bash
npm install @asoc/mcp-server
```

## Quick Start

### Run Standalone Server

```bash
# Development mode
cd packages/mcp-server
npm run dev

# Production mode
ASOC_SECRET_KEY=your-secret npm start
```

### Integrate with Your Application

```typescript
import { createAsocMcpServer } from '@asoc/mcp';
import { TicketIssuer } from '@asoc/sdk';

const issuer = new TicketIssuer({
  signingKey: process.env.ASOC_SECRET_KEY!,
  issuer: 'asoc-authority.com',
});

const mcpServer = createAsocMcpServer(issuer);
// Connect your transport (HTTP, stdio, WebSocket, etc.)
```

## Available Tools

### 1. `is_agent_certified`

Quick boolean check for agent certification status.

**Input:**
```json
{
  "agentId": "agent-12345"
}
```

**Output:**
```json
{
  "certified": true,
  "agentId": "agent-12345",
  "auditLevel": "Gold",
  "expiresAt": 1767890123,
  "killSwitchActive": false
}
```

### 2. `get_trust_score`

Calculate comprehensive trust score with behavioral factors.

**Input:**
```json
{
  "agentId": "agent-12345",
  "includeHealth": true
}
```

**Output:**
```json
{
  "agentId": "agent-12345",
  "score": 85,
  "level": "Gold",
  "factors": {
    "certification": 100,
    "behavioral_health": 92,
    "transaction_history": 77,
    "domain_verification": 100
  },
  "recommendation": "approve",
  "details": {
    "uptime_percentage": 99.8,
    "avg_latency_ms": 120,
    "error_rate": 0.002,
    "total_transactions": 15420,
    "last_active": 1734567890
  }
}
```

### 3. `issue_audit_ticket`

Generate signed JWT ticket for x402 transactions.

**Input:**
```json
{
  "agentId": "agent-12345",
  "validitySeconds": 300
}
```

**Output:**
```json
{
  "success": true,
  "ticket": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "agentId": "agent-12345",
  "expiresIn": 300
}
```

### 4. `query_agents`

Search for agents by criteria.

**Input:**
```json
{
  "minTrustScore": 70,
  "auditLevel": "Gold",
  "capabilities": ["trading"],
  "limit": 5
}
```

**Output:**
```json
{
  "results": [
    {
      "agentId": "agent-12345",
      "organization": "Acme AI Corp",
      "auditLevel": "Gold",
      "trustScore": 85,
      "capabilities": ["trading", "portfolio-analysis"]
    }
  ],
  "total": 1
}
```

### 5. `activate_kill_switch`

Emergency disable an agent.

**Input:**
```json
{
  "agentId": "agent-12345",
  "reason": "Suspicious activity detected",
  "revokeTickets": true
}
```

**Output:**
```json
{
  "success": true,
  "agentId": "agent-12345",
  "timestamp": 1734567890,
  "reason": "Suspicious activity detected"
}
```

## MCP Client Integration

### Using MCP TypeScript SDK

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { HttpClientTransport } from '@modelcontextprotocol/sdk/client/http.js';

const client = new Client({
  name: 'my-agent',
  version: '1.0.0',
});

const transport = new HttpClientTransport('http://localhost:3100/mcp');
await client.connect(transport);

// Check if agent is certified
const result = await client.callTool({
  name: 'is_agent_certified',
  arguments: { agentId: 'agent-12345' },
});

console.log(result.content[0].text);
```

### Using cURL

```bash
# Check certification
curl -X POST http://localhost:3100/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "is_agent_certified",
      "arguments": {
        "agentId": "agent-12345"
      }
    }
  }'
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP server port | 3100 |
| `ASOC_SECRET_KEY` | JWT signing key | _(dev key)_ |
| `NODE_ENV` | Environment | development |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    MCP Client                           │
│              (Claude, GPT, Custom Agent)                │
└────────────────────┬────────────────────────────────────┘
                     │
                     │ MCP Protocol
                     │
┌────────────────────▼────────────────────────────────────┐
│              A-SOC MCP Server                           │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Tools:                                         │   │
│  │  • is_agent_certified                           │   │
│  │  • get_trust_score                              │   │
│  │  • issue_audit_ticket                           │   │
│  │  • query_agents                                 │   │
│  │  • activate_kill_switch                         │   │
│  └─────────────────────────────────────────────────┘   │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
           ┌─────────────────────┐
           │  Agent Registry     │
           │  (In-Memory / DB)   │
           └─────────────────────┘
```

## Production Considerations

1. **Replace In-Memory Registry**: Use PostgreSQL/Redis for persistence
2. **Add Authentication**: Protect MCP endpoints with API keys
3. **Enable Rate Limiting**: Prevent abuse of certificate issuance
4. **Implement Caching**: Cache trust scores for 1-5 minutes
5. **Add Monitoring**: Track tool usage and latency
6. **Use Secure Keys**: Rotate `ASOC_SECRET_KEY` regularly
7. **Enable HTTPS**: Use TLS in production environments

## Demo Data

The server ships with 2 demo agents:

- **agent-12345**: Gold tier, high trust score (85)
- **agent-67890**: Silver tier, moderate trust score (68)

Replace `seedDemoAgents()` in `index.ts` with your database integration.

## Next Steps

1. Build custom agent registry backend
2. Integrate with x402 payment gateways
3. Add webhooks for kill switch notifications
4. Implement behavioral scoring ML model
5. Create agent onboarding dashboard
