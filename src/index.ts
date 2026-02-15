import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TicketIssuer, guard, redact, guardTool, Agntor } from '@agntor/sdk';
import { AgentCardSchema, AgentPulseSchema, AgentRegistrationSchema } from './schemas.js';
import {
  AgentRecord,
  TrustScore,
  VerifyAgentRequest,
  IssueTicketRequest,
  QueryAgentsRequest,
  KillSwitchRequest,
} from './types.js';

// Helper to get configured SDK instance
function getAgntorClient() {
    const apiKey = process.env.AGNTOR_API_KEY || 'mock_key';
    const apiUrl = process.env.AGNTOR_API_URL || 'https://app.agntor.com';
    return new Agntor({
      apiKey,
      agentId: process.env.AGNTOR_AGENT_ID || 'agent://mcp-server',
      chain: process.env.AGNTOR_CHAIN || 'base',
      baseUrl: apiUrl,
    });
}

/**
 * Helper to fetch agent record via SDK
 */
async function getAgentRecord(agentId: string): Promise<AgentRecord | null> {
    const agntor = getAgntorClient();
    try {
        const raw = await agntor.getAgent(agentId) as Record<string, any>;
        
        // Map the API response shape to our internal AgentRecord format.
        // API returns: { id, identity: { handle, address }, profile: { organization, version, metadata },
        //               trust: { score, level, certified }, status: { active } }
        const identity = raw.identity ?? {};
        const profile = raw.profile ?? {};
        const trust = raw.trust ?? {};
        const status = raw.status ?? {};
        const meta = profile.metadata ?? {};

        const record: AgentRecord = {
            agentId: raw.id ?? agentId,
            auditLevel: (trust.level ?? 'Bronze') as AgentRecord['auditLevel'],
            trustScore: trust.score ?? 0,
            organization: profile.organization ?? 'Unknown',
            metadata: {
                name: identity.handle ?? meta.name ?? 'Unknown Agent',
                description: meta.description ?? '',
                capabilities: meta.capabilities ?? [],
                verified_domain: meta.verified_domain,
            },
            certification: {
                certified_at: trust.certified ? Date.now() : 0,
                expires_at: trust.certified ? Date.now() + 365 * 24 * 60 * 60 * 1000 : 0,
                certifier: 'agntor.com',
                mva_level: trust.level === 'Platinum' ? 5 : trust.level === 'Gold' ? 4 : trust.level === 'Silver' ? 3 : 1,
            },
            health: {
            uptime_percentage: meta.uptime_percentage ?? 0,
            avg_latency_ms: meta.avg_latency_ms ?? 0,
            error_rate: meta.error_rate ?? 0,
                total_transactions: meta.total_transactions ?? 0,
                last_active: meta.last_active ?? Date.now(),
            },
            killSwitchActive: !(status.active ?? true),
            constraints: {
                max_op_value: meta.max_op_value ?? 10000,
                allowed_mcp_servers: meta.allowed_mcp_servers ?? [],
                max_ops_per_hour: meta.max_ops_per_hour,
                requires_x402_payment: meta.requires_x402_payment,
            },
        };

        return record;
    } catch (e) {
        console.error(`[MCP] getAgentRecord failed for ${agentId}:`, (e as Error).message);
        return null;
    }
}

/**
 * Creates and configures the Agntor MCP server
 */
export function createAgntorMcpServer(issuer: TicketIssuer) {
  const server = new McpServer({
    name: 'agntor-audit-server',
    version: '0.1.0',
  });

  /**
   * Tool: get_agent_card
   * 
   * Retrieve the public "Passport" (AgentCard) for an agent.
   * This is used by other agents to verify identity before interaction.
   */
  server.registerTool(
    'get_agent_card',
    {
      title: 'Get Agent Card',
      description: 'Retrieve the verifiable AgentCard (Passport) for an agent',
      inputSchema: {
        agentId: z.string().describe('The agent ID to retrieve'),
      },
      outputSchema: AgentCardSchema,
    },
    async ({ agentId }) => {
      const agent = await getAgentRecord(agentId);

      if (!agent) {
        throw new Error(`Agent ${agentId} not found`);
      }

      // Map internal record to public AgentCard
      const card = {
        id: agent.agentId,
        name: agent.metadata.name,
        organization: agent.organization,
        version: '1.0.0', // Placeholder
        audit_level: agent.auditLevel as any,
        trust_score: agent.trustScore,
        certified_at: new Date(agent.certification.certified_at).toISOString(),
        expires_at: new Date(agent.certification.expires_at).toISOString(),
        capabilities: agent.metadata.capabilities,
        constraints: {
          max_transaction_value: agent.constraints.max_op_value,
          allowed_domains: [], // Placeholder
          requires_human_approval: false,
          requires_x402_payment: Boolean((agent.constraints as any)?.requires_x402_payment ?? true),
        },
        issuer: 'agntor.com',
        signature: `agntor:${agent.agentId}:${Date.now()}`, // Real signatures require on-chain integration
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(card) }],
        structuredContent: card,
      };
    }
  );

  /**
   * Tool: get_agent_registration
   * 
   * Returns an EIP-8004 registration file for agent discovery.
   */
  server.registerTool(
    'get_agent_registration',
    {
      title: 'Get Agent Registration',
      description: 'Retrieve the EIP-8004 agent registration file',
      inputSchema: {
        agentId: z.string().describe('The agent ID to retrieve'),
      },
      outputSchema: AgentRegistrationSchema,
    },
    async ({ agentId }) => {
      const agent = await getAgentRecord(agentId);
      if (!agent) {
        throw new Error(`Agent ${agentId} not found`);
      }

      const registry = (agent.metadata as any)?.agentRegistry ?? 'eip155:1:0x0000000000000000000000000000000000000000';
      const registrationId = Number.parseInt(agent.agentId, 10);
      const endpoints = (agent.metadata as any)?.endpoints ?? [
        {
          name: 'MCP',
          endpoint: 'https://agntor.com/mcp',
          version: '2025-06-18',
          capabilities: agent.metadata.capabilities ?? [],
        },
      ];

      const registration = {
        type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
        name: agent.metadata.name,
        description: agent.metadata.description || 'Agntor-registered agent',
        image: (agent.metadata as any)?.image,
        endpoints,
        x402Support: true,
        active: !agent.killSwitchActive,
        registrations: [
          {
            agentId: Number.isNaN(registrationId) ? 0 : registrationId,
            agentRegistry: registry,
          },
        ],
        supportedTrust: ['reputation', 'validation', 'crypto-economic'],
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(registration) }],
        structuredContent: registration,
      };
    }
  );

  /**
   * Tool: check_agent_pulse
   * 
   * Get real-time behavioral health metrics.
   */
  server.registerTool(
    'check_agent_pulse',
    {
      title: 'Check Agent Pulse',
      description: 'Get real-time health and behavioral metrics',
      inputSchema: {
        agentId: z.string(),
      },
      outputSchema: AgentPulseSchema,
    },
    async ({ agentId }) => {
      const agent = await getAgentRecord(agentId);
      if (!agent) throw new Error(`Agent ${agentId} not found`);

      const pulse = {
        agent_id: agent.agentId,
        status: agent.killSwitchActive ? 'critical' : 'healthy',
        metrics: {
          uptime_24h: agent.health.uptime_percentage,
          error_rate_1h: agent.health.error_rate,
          avg_latency_ms: agent.health.avg_latency_ms,
          spend_velocity_1h: 0, // Placeholder
        },
        last_heartbeat: new Date(agent.health.last_active).toISOString(),
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(pulse) }],
        structuredContent: pulse as any,
      };
    }
  );

  /**
   * Tool: is_agent_certified
   * 
   * Quick boolean check if an agent is currently certified
   */
  server.registerTool(
    'is_agent_certified',
    {
      title: 'Check Agent Certification',
      description: 'Verify if an agent has valid Agntor certification',
      inputSchema: {
        agentId: z.string().describe('The agent ID to check'),
      },
      outputSchema: {
        certified: z.boolean(),
        agentId: z.string(),
        auditLevel: z.string().optional(),
        expiresAt: z.number().optional(),
        killSwitchActive: z.boolean().optional(),
      },
    },
    async ({ agentId }) => {
      const agent = await getAgentRecord(agentId);

      if (!agent) {
        const output = { certified: false, agentId };
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
        };
      }

      const now = Date.now();
      const isCertified =
        agent.certification.expires_at > now && !agent.killSwitchActive;

      const output = {
        certified: isCertified,
        agentId: agent.agentId,
        auditLevel: agent.auditLevel,
        expiresAt: agent.certification.expires_at,
        killSwitchActive: agent.killSwitchActive,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    }
  );

  /**
   * Tool: guard_input
   * 
   * Input validation to detect prompt injection and unsafe instructions.
   */
  server.registerTool(
    'guard_input',
    {
      title: 'Guard Input',
      description: 'Scan incoming prompts for unsafe or malicious instructions',
      inputSchema: {
        input: z.string(),
        context: z.any().optional(),
        policy: z.any().optional(),
      },
      outputSchema: {
        classification: z.enum(['pass', 'block']),
        violation_types: z.array(z.string()),
        cwe_codes: z.array(z.string()),
        usage: z.object({
          promptTokens: z.number(),
          completionTokens: z.number(),
          totalTokens: z.number(),
        }).optional(),
      },
    },
    async ({ input, policy }) => {
      const result = await guard(input, policy ?? {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    }
  );

  /**
   * Tool: redact_output
   * 
   * Redact sensitive outputs before returning to users.
   */
  server.registerTool(
    'redact_output',
    {
      title: 'Redact Output',
      description: 'Scan and redact sensitive content from outputs',
      inputSchema: {
        input: z.string(),
        policy: z.any().optional(),
      },
      outputSchema: {
        redacted: z.string(),
        findings: z.array(z.object({
          type: z.string(),
          span: z.tuple([z.number(), z.number()]),
          value: z.string().optional(),
        })),
      },
    },
    async ({ input, policy }) => {
      const result = redact(input, policy ?? {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    }
  );

  /**
   * Tool: guard_tool
   * 
   * Control tool execution with allow/deny policies.
   */
  server.registerTool(
    'guard_tool',
    {
      title: 'Guard Tool',
      description: 'Authorize or block tool execution',
      inputSchema: {
        tool: z.string(),
        args: z.any(),
        policy: z.any().optional(),
      },
      outputSchema: {
        allowed: z.boolean(),
        violations: z.array(z.string()).optional(),
        reason: z.string().optional(),
      },
    },
    async ({ tool, args, policy }) => {
      const result = guardTool(tool, args, policy ?? {});
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
      };
    }
  );

  /**
   * Tool: get_trust_score
   * 
   * Calculate and return detailed trust score for an agent
   */
  server.registerTool(
    'get_trust_score',
    {
      title: 'Get Agent Trust Score',
      description: 'Calculate comprehensive trust score with behavioral factors',
      inputSchema: VerifyAgentRequest.shape,
      outputSchema: {
        agentId: z.string(),
        score: z.number(),
        level: z.string(),
        factors: z.object({
          certification: z.number(),
          behavioral_health: z.number(),
          transaction_history: z.number(),
          domain_verification: z.number(),
        }),
        recommendation: z.enum(['approve', 'review', 'reject']),
        details: z.any().optional(),
      },
    },
    async ({ agentId, includeHealth }) => {
      const agntor = getAgntorClient();

      try {
        // Fetch agent data (single call, extract score from response)
        const agentData = await agntor.getAgent(agentId) as Record<string, any>;
        const score = agentData?.trust?.score ?? 0;
        
        // Map SDK/API response to tool output
        const trustScore: TrustScore = {
            agentId,
            score: score || 0,
            level: agentData.auditLevel || 'None',
            factors: {
                certification: agentData.trust?.factors?.certification || 0,
                behavioral_health: agentData.trust?.factors?.behavioral_health || 0,
                transaction_history: agentData.trust?.factors?.transaction_history || 0,
                domain_verification: agentData.trust?.factors?.domain_verification || 0
            },
            recommendation: score >= 80 ? 'approve' : score >= 60 ? 'review' : 'reject'
        };

        const output = {
            ...trustScore,
            details: includeHealth ? agentData.health : undefined
        };

        return {
            content: [{ type: 'text', text: JSON.stringify(output) }],
            structuredContent: output,
        };
      } catch (error) {
        // Fallback or error handling
         return {
            content: [{ type: 'text', text: `Error fetching trust score: ${error}` }],
            isError: true
        };
      }
    }
  );

  /**
   * Tool: issue_audit_ticket
   * 
   * Generate a signed audit ticket for a certified agent
   */
  server.registerTool(
    'issue_audit_ticket',
    {
      title: 'Issue Audit Ticket',
      description: 'Generate signed JWT ticket for x402 transactions',
      inputSchema: IssueTicketRequest.shape,
      outputSchema: {
        success: z.boolean(),
        ticket: z.string().optional(),
        agentId: z.string(),
        expiresIn: z.number().optional(),
        error: z.string().optional(),
      },
    },
    async ({ agentId, validitySeconds }) => {
      const agent = await getAgentRecord(agentId);

      if (!agent) {
        return {
          content: [{ type: 'text', text: 'Agent not found' }],
          structuredContent: {
            success: false,
            agentId,
            error: 'Agent not found',
          },
        };
      }

      if (agent.killSwitchActive) {
        return {
          content: [{ type: 'text', text: 'Agent kill switch active' }],
          structuredContent: {
            success: false,
            agentId,
            error: 'Agent kill switch active',
          },
        };
      }

      const ticket = issuer.generateTicket({
        agentId: agent.agentId,
        auditLevel: agent.auditLevel,
        constraints: agent.constraints,
        validitySeconds,
      });

      const output = {
        success: true,
        ticket,
        agentId,
        expiresIn: validitySeconds || 300,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    }
  );

  /**
   * Tool: query_agents
   * 
   * Search for agents by criteria
   */
  server.registerTool(
    'query_agents',
    {
      title: 'Query Agents',
      description: 'Search for agents by criteria',
      inputSchema: QueryAgentsRequest.shape,
      outputSchema: {
        results: z.array(z.any()),
        total: z.number(),
      },
    },
    async ({ minTrustScore, auditLevel, capabilities, limit }) => {
      const agntor = getAgntorClient();
      try {
          const response = await agntor.queryAgents({ minTrustScore, auditLevel, capabilities, limit });
          return {
            content: [{ type: 'text', text: JSON.stringify(response.results) }],
            structuredContent: response,
          };
      } catch (error) {
           return {
            content: [{ type: 'text', text: `Error querying agents: ${error}` }],
            isError: true
          };
      }
    }
  );

  /**
   * Tool: activate_kill_switch
   * 
   * Emergency disable an agent
   */
  server.registerTool(
    'activate_kill_switch',
    {
      title: 'Activate Kill Switch',
      description: 'Emergency disable an agent',
      inputSchema: KillSwitchRequest.shape,
      outputSchema: {
        success: z.boolean(),
        agentId: z.string(),
        timestamp: z.number(),
        reason: z.string(),
      },
    },
    async ({ agentId, reason }) => {
      const agntor = getAgntorClient();
      try {
          const result = await agntor.activateKillSwitch(agentId, reason);
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            structuredContent: result,
          };
      } catch (error) {
          return {
            content: [{ type: 'text', text: `Error activating kill switch: ${error}` }],
            isError: true
          };
      }
    }
  );

  /**
   * Tool: create_escrow
   * 
   * Create an escrow task via Agntor API (uses SDK)
   */
  server.registerTool(
    'create_escrow',
    {
      title: 'Create Escrow',
      description: 'Create a new escrow task for payment',
      inputSchema: z.object({
        agentId: z.string(),
        target: z.string(),
        amount: z.number(),
        task: z.string()
      }),
      outputSchema: z.any()
    },
    async ({ agentId, target, amount, task }) => {
       const agntor = getAgntorClient();
       
       try {
           const result = await agntor.createEscrowLegacy({ agentId, target, amount, task });
           return {
             content: [{ type: 'text', text: JSON.stringify(result) }],
             structuredContent: result
           };
       } catch (e: any) {
           return {
               content: [{ type: 'text', text: `Error: ${e.message}` }],
               isError: true
           };
       }
    }
  );

  /**
   * Tool: verify_agent_identity
   * 
   * Verify agent identity using Agntor SDK
   */
  server.registerTool(
    'verify_agent_identity',
    {
      title: 'Verify Agent Identity',
      description: 'Trigger self-verification via SDK',
      inputSchema: z.object({
        agentId: z.string().optional()
      }),
      outputSchema: z.any()
    },
    async ({ agentId }) => {
       const agntor = getAgntorClient();
       
       try {
           const result = await agntor.verifyLegacy(agentId);
           return {
             content: [{ type: 'text', text: JSON.stringify(result) }],
             structuredContent: result
           };
       } catch (e: any) {
           return {
               content: [{ type: 'text', text: `Error: ${e.message}` }],
               isError: true
           };
       }
    }
  );

  /**
   * Tool: register_agent
   * 
   * Register a new agent in the Agntor network
   */
  server.registerTool(
    'register_agent',
    {
      title: 'Register Agent',
      description: 'Register a new AI agent in the Agntor trust network',
      inputSchema: z.object({
        name: z.string().describe('Unique agent name/handle'),
        organization: z.string().optional().describe('Organization or company name'),
        description: z.string().optional().describe('What this agent does'),
        capabilities: z.array(z.string()).optional().describe('Agent capabilities (e.g. ["trade", "email", "search"])'),
        endpoint: z.string().optional().describe('Agent API endpoint URL'),
        walletAddress: z.string().optional().describe('Blockchain wallet address'),
      }),
      outputSchema: z.object({
        success: z.boolean(),
        agent: z.object({
          id: z.string(),
          name: z.string(),
          organization: z.string(),
          auditLevel: z.string(),
          trustScore: z.number(),
          status: z.string(),
        }).optional(),
        message: z.string().optional(),
        error: z.string().optional(),
      }),
    },
    async ({ name, organization, description, capabilities, endpoint, walletAddress }) => {
      const agntor = getAgntorClient();

      try {
        const result = await agntor.request<any>('/api/v1/identity/register', {
          method: 'POST',
          body: JSON.stringify({
            name,
            organization,
            description,
            capabilities,
            endpoint,
            walletAddress,
          }),
        });

        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (e: any) {
        return {
          content: [{ type: 'text' as const, text: `Error: ${e.message}` }],
          isError: true,
        };
      }
    }
  );

  return server;
}
