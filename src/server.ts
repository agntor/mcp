#!/usr/bin/env node

import 'dotenv/config';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TicketIssuer } from '@agntor/sdk';
import { z } from 'zod';
import { db, apiKeys } from '@agntor/database';
import { eq } from 'drizzle-orm';
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

// Setup Express with MCP transport
const app = express();
app.use(express.json());

async function verifyApiKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  const header = req.header('x-agntor-api-key') || req.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : header;

  if (!token) {
     if (!ADMIN_API_KEY) return next(); // Development mode if no keys set

     return res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing API Key',
    });
  }

  // 1. Check Admin Key (Bootstrap)
  if (ADMIN_API_KEY && token === ADMIN_API_KEY) {
    return next();
  }

  // 2. Check Database Keys
  try {
    const keyRecord = await db.query.apiKeys.findFirst({
      where: eq(apiKeys.key, token),
    });

    if (keyRecord && keyRecord.isActive) {
      // Update last used asynchronously
      await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, keyRecord.id));
      return next();
    }
  } catch (error) {
    console.error('Database key verification failed:', error);
  }

  return res.status(401).json({
    error: 'Unauthorized',
    message: 'Invalid API Key',
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    server: 'agntor-audit-mcp',
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
╔═══════════════════════════════════════════════════════════╗
║         Agntor MCP Audit Server                            ║
╠═══════════════════════════════════════════════════════════╣
║  Status:    RUNNING                                       ║
║  Port:      ${PORT}                                       ║
║  Endpoint:  http://localhost:${PORT}/mcp                  ║
║  Health:    http://localhost:${PORT}/health               ║
╠═══════════════════════════════════════════════════════════╣
║  Tools Available:                                         ║
║    • is_agent_certified                                   ║
║    • get_trust_score                                      ║
║    • issue_audit_ticket                                   ║
║    • query_agents                                         ║
║    • activate_kill_switch                                 ║
║    • guard_input                                          ║
║    • redact_output                                        ║
║    • guard_tool                                           ║
║    • get_agent_registration                               ║
╚═══════════════════════════════════════════════════════════╝
  `);
});
