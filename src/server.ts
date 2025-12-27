#!/usr/bin/env node

import 'dotenv/config';
import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TicketIssuer } from '@asoc/sdk';
import { z } from 'zod';
import { createAsocMcpServer } from './index.js';

const PORT = process.env.PORT || 3100;
const ASOC_SECRET = process.env.ASOC_SECRET_KEY || 'dev-secret-key-change-in-production';

// Initialize ticket issuer
const issuer = new TicketIssuer({
  signingKey: ASOC_SECRET,
  issuer: 'asoc-authority.com',
  algorithm: 'HS256',
  defaultValidity: 300, // 5 minutes
});

// Create MCP server
const mcpServer = createAsocMcpServer(issuer);

// Setup Express with MCP transport
const app = express();
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    server: 'asoc-audit-mcp',
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
║         A-SOC MCP Audit Server                            ║
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
╚═══════════════════════════════════════════════════════════╝
  `);
});
