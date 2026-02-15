import 'dotenv/config';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TicketIssuer } from '@agntor/sdk';
import { createAgntorMcpServer } from './index.js';

const PORT = process.env.PORT || 3100;
const AGNTOR_SECRET = process.env.AGNTOR_SECRET_KEY || 'dev-secret-key-change-in-production';
const ADMIN_API_KEY = process.env.AGNTOR_API_KEY;

// Initialize ticket issuer
const issuer = new TicketIssuer({
  signingKey: AGNTOR_SECRET,
  issuer: 'agntor.com',
  algorithm: 'HS256',
  defaultValidity: 300, // 5 minutes
});

// Create MCP server
const mcpServer = createAgntorMcpServer(issuer);

// Detect transport mode: stdio (for MCP clients like VSCode/Claude) or HTTP
const useStdio = process.argv.includes('--stdio') || process.env.MCP_TRANSPORT === 'stdio';

if (useStdio) {
  // --- STDIO Transport (for Claude Desktop, VSCode, Cursor, etc.) ---
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
  console.error('[agntor-mcp] Connected via stdio transport');
} else {
  // --- HTTP Transport (for remote/hosted usage) ---
  const app = express();
  app.use(express.json());

  function verifyApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
    // In dev mode (no ADMIN_API_KEY set), allow all requests
    if (!ADMIN_API_KEY) return next();

    const header = req.header('x-agntor-api-key') || req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : header;

    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing API Key. Set x-agntor-api-key header or Authorization: Bearer <key>',
      });
    }

    if (token === ADMIN_API_KEY) {
      return next();
    }

    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid API Key',
    });
  }

  // Health check endpoint
  app.get('/health', (_req, res) => {
    res.json({
      status: 'healthy',
      server: 'agntor-mcp',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    });
  });

  // MCP endpoint
  app.post('/mcp', verifyApiKey, async (req, res) => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on('close', () => transport.close());

    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // Start server
  app.listen(PORT, () => {
    console.log(`
  Agntor MCP Server v0.1.0
  
  Transport:  HTTP
  Port:       ${PORT}
  Endpoint:   http://localhost:${PORT}/mcp
  Health:     http://localhost:${PORT}/health
  Auth:       ${ADMIN_API_KEY ? 'API key required' : 'Open (dev mode)'}

  Tools: get_agent_card, get_agent_registration, check_agent_pulse,
         is_agent_certified, guard_input, redact_output, guard_tool,
         get_trust_score, issue_audit_ticket, query_agents,
         activate_kill_switch, create_escrow, verify_agent_identity
    `);
  });
}
