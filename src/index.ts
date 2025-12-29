import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TicketIssuer } from '@asoc/sdk';
import { db, agents, certifications, healthMetrics } from '@asoc/database';
import { eq, desc, and, gte } from 'drizzle-orm';
import { AgentCardSchema, AgentPulseSchema } from './schemas.js';
import {
  AgentRecord,
  TrustScore,
  VerifyAgentRequest,
  IssueTicketRequest,
  QueryAgentsRequest,
  KillSwitchRequest,
} from './types.js';

/**
 * Helper to map DB result to AgentRecord
 */
async function getAgentRecord(agentId: string): Promise<AgentRecord | null> {
  const agent = await db.query.agents.findFirst({
    where: eq(agents.id, agentId),
    with: {
      certifications: {
        orderBy: (certs, { desc }) => [desc(certs.issuedAt)],
        limit: 1,
      },
      healthMetrics: {
        orderBy: (metrics, { desc }) => [desc(metrics.recordedAt)],
        limit: 1,
      },
    },
  });

  if (!agent) return null;

  const latestCert = agent.certifications[0];
  const latestHealth = agent.healthMetrics[0];
  const metadata = agent.metadata as any || {};

  return {
    agentId: agent.id,
    auditLevel: (agent.auditLevel as any) || 'Bronze',
    trustScore: agent.trustScore || 0,
    organization: agent.organization,
    metadata: {
      name: agent.name,
      description: metadata.description || '',
      capabilities: metadata.capabilities || [],
      verified_domain: metadata.verified_domain,
    },
    certification: {
      certified_at: latestCert?.issuedAt ? new Date(latestCert.issuedAt).getTime() : 0,
      expires_at: latestCert?.expiresAt ? new Date(latestCert.expiresAt).getTime() : 0,
      certifier: latestCert?.issuer || 'unknown',
      mva_level: latestCert?.mvaLevel || 0,
    },
    health: {
      uptime_percentage: latestHealth?.uptimePercentage || 0,
      avg_latency_ms: latestHealth?.avgLatencyMs || 0,
      error_rate: latestHealth?.errorRate || 0,
      total_transactions: 0,
      last_active: latestHealth?.recordedAt ? new Date(latestHealth.recordedAt).getTime() : 0,
    },
    killSwitchActive: agent.killSwitchActive || false,
    constraints: metadata.constraints || {
      max_op_value: 0,
      allowed_mcp_servers: [],
    },
  };
}

/**
 * Creates and configures the A-SOC MCP server
 */
export function createAsocMcpServer(issuer: TicketIssuer) {
  const server = new McpServer({
    name: 'asoc-audit-server',
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
        },
        issuer: 'asoc-authority.com',
        signature: 'simulated_signature_0x123456789', // Placeholder
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(card) }],
        structuredContent: card,
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
      description: 'Verify if an agent has valid A-SOC certification',
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
      const agent = await getAgentRecord(agentId);

      if (!agent) {
        const output = {
          agentId,
          score: 0,
          level: 'None',
          factors: {
            certification: 0,
            behavioral_health: 0,
            transaction_history: 0,
            domain_verification: 0,
          },
          recommendation: 'reject' as const,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          structuredContent: output,
        };
      }

      // Calculate trust factors
      const certificationScore = agent.killSwitchActive
        ? 0
        : (agent.certification.mva_level / 5) * 100;

      const healthScore =
        agent.health.uptime_percentage * 0.4 +
        (1 - agent.health.error_rate) * 100 * 0.3 +
        Math.max(0, 100 - agent.health.avg_latency_ms / 5) * 0.3;

      const txScore = Math.min(
        100,
        (agent.health.total_transactions / 10000) * 100
      );

      const domainScore = agent.metadata.verified_domain ? 100 : 50;

      const trustScore: TrustScore = {
        agentId: agent.agentId,
        score: agent.trustScore,
        level: agent.auditLevel,
        factors: {
          certification: Math.round(certificationScore),
          behavioral_health: Math.round(healthScore),
          transaction_history: Math.round(txScore),
          domain_verification: domainScore,
        },
        recommendation:
          agent.trustScore >= 80
            ? 'approve'
            : agent.trustScore >= 60
            ? 'review'
            : 'reject',
      };

      const output = {
        ...trustScore,
        details: includeHealth ? agent.health : undefined,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
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
      const conditions = [];
      if (minTrustScore) conditions.push(gte(agents.trustScore, minTrustScore));
      if (auditLevel) conditions.push(eq(agents.auditLevel, auditLevel));
      
      const allAgents = await db.query.agents.findMany({
        where: conditions.length > 0 ? and(...conditions) : undefined,
        limit: limit || 10,
      });

      let results = allAgents;
      if (capabilities && capabilities.length > 0) {
        results = results.filter(a => {
          const caps = (a.metadata as any)?.capabilities || [];
          return capabilities.every(c => caps.includes(c));
        });
      }

      const mappedResults = results.map((a) => ({
        agentId: a.id,
        organization: a.organization,
        auditLevel: a.auditLevel,
        trustScore: a.trustScore,
        capabilities: (a.metadata as any)?.capabilities || [],
      }));

      return {
        content: [{ type: 'text', text: JSON.stringify(mappedResults) }],
        structuredContent: {
          results: mappedResults,
          total: mappedResults.length,
        },
      };
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
      await db.update(agents)
        .set({ killSwitchActive: true })
        .where(eq(agents.id, agentId));

      const output = {
        success: true,
        agentId,
        timestamp: Date.now(),
        reason,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(output) }],
        structuredContent: output,
      };
    }
  );

  return server;
}
