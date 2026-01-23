import { z } from 'zod';

/**
 * Agent certification record stored in registry
 */
export interface AgentRecord {
  /** Unique agent identifier */
  agentId: string;
  
  /** Current audit level */
  auditLevel: 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
  
  /** Trust score (0-100) */
  trustScore: number;
  
  /** Company/owner of the agent */
  organization: string;
  
  /** Agent metadata */
  metadata: {
    name: string;
    description: string;
    capabilities: string[];
    verified_domain?: string;
  };
  
  /** Certification details */
  certification: {
    certified_at: number; // Unix timestamp
    expires_at: number;
    certifier: string;
    mva_level: number; // 1-5
  };
  
  /** Behavioral health metrics */
  health: {
    uptime_percentage: number;
    avg_latency_ms: number;
    error_rate: number;
    total_transactions: number;
    last_active: number;
  };
  
  /** Kill switch status */
  killSwitchActive: boolean;
  
  /** Constraints from latest issued ticket */
  constraints: {
    max_op_value: number;
    allowed_mcp_servers: string[];
    max_ops_per_hour?: number;
    requires_x402_payment?: boolean;
  };
}

/**
 * Trust score calculation result
 */
export interface TrustScore {
  agentId: string;
  score: number;
  level: 'Bronze' | 'Silver' | 'Gold' | 'Platinum';
  factors: {
    certification: number;
    behavioral_health: number;
    transaction_history: number;
    domain_verification: number;
  };
  recommendation: 'approve' | 'review' | 'reject';
}

/**
 * Agent verification request
 */
export const VerifyAgentRequest = z.object({
  agentId: z.string().describe('The agent ID to verify'),
  includeHealth: z.boolean().optional().describe('Include behavioral health metrics'),
});

/**
 * Issue ticket request
 */
export const IssueTicketRequest = z.object({
  agentId: z.string().describe('Agent ID to issue ticket for'),
  validitySeconds: z.number().optional().describe('Ticket validity in seconds (default: 300)'),
});

/**
 * Query agents request
 */
export const QueryAgentsRequest = z.object({
  minTrustScore: z.number().optional().describe('Minimum trust score (0-100)'),
  auditLevel: z.enum(['Bronze', 'Silver', 'Gold', 'Platinum']).optional(),
  capabilities: z.array(z.string()).optional().describe('Required capabilities'),
  limit: z.number().optional().describe('Maximum results (default: 10)'),
});

/**
 * Activate kill switch request
 */
export const KillSwitchRequest = z.object({
  agentId: z.string().describe('Agent ID to disable'),
  reason: z.string().describe('Reason for kill switch activation'),
  revokeTickets: z.boolean().optional().describe('Revoke all existing tickets (default: true)'),
});
