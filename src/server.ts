#!/usr/bin/env node

import 'dotenv/config';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TicketIssuer } from '@agntor/sdk';
import { z } from 'zod';
import { createAgntorMcpServer } from './index.js';

const PORT = process.env.PORT || 3100;
const AGNTOR_SECRET = process.env.AGNTOR_SECRET_KEY || 'dev-secret-key-change-in-production';

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
app.post('/mcp', async (req, res) => {
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
