import { z } from 'zod';

/**
 * The "AgentCard" - A portable, verifiable identity for AI Agents.
 * This is the "Passport" that agents present to prove their certification.
 */
export const AgentCardSchema = z.object({
  // Identity
  id: z.string().describe("Unique Agent ID (DID or UUID)"),
  name: z.string().describe("Display name of the agent"),
  organization: z.string().describe("Legal entity owning the agent"),
  version: z.string().describe("Semantic version of the agent code"),
  
  // Certification
  audit_level: z.enum(['Bronze', 'Silver', 'Gold', 'Platinum']).describe("A-SOC Certification Level"),
  trust_score: z.number().min(0).max(100).describe("Real-time trust score (0-100)"),
  certified_at: z.string().datetime().describe("ISO timestamp of last full audit"),
  expires_at: z.string().datetime().describe("ISO timestamp when certification expires"),
  
  // Capabilities & Constraints
  capabilities: z.array(z.string()).describe("List of allowed actions (e.g., 'trade', 'email')"),
  constraints: z.object({
    max_transaction_value: z.number().describe("Hard cap on single transaction value (USD)"),
    allowed_domains: z.array(z.string()).describe("Whitelisted external domains"),
    requires_human_approval: z.boolean().describe("If true, high-risk actions need human sign-off"),
  }),
  
  // Verification
  issuer: z.string().describe("Authority that issued this card (e.g., 'asoc-authority.com')"),
  signature: z.string().describe("Cryptographic signature of this card"),
});

export type AgentCard = z.infer<typeof AgentCardSchema>;

/**
 * Real-time "Pulse" Health Check
 * This data is NOT on the static card, but queried live.
 */
export const AgentPulseSchema = z.object({
  agent_id: z.string(),
  status: z.enum(['healthy', 'degraded', 'critical', 'offline']),
  metrics: z.object({
    uptime_24h: z.number().min(0).max(100),
    error_rate_1h: z.number().min(0).max(1),
    avg_latency_ms: z.number(),
    spend_velocity_1h: z.number().describe("USD spent in last hour"),
  }),
  last_heartbeat: z.string().datetime(),
});

export type AgentPulse = z.infer<typeof AgentPulseSchema>;
