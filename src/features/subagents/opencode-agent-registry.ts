import { z } from "zod/mini";

export const OpenCodeAgentRegistryEntrySchema = z.object({
  slug: z.string(),
  name: z.string(),
  file: z.string(),
  category: z.union([z.string(), z.literal("")]),
  capabilities: z.optional(z.array(z.string())),
  mcp_servers: z.optional(z.array(z.string())),
  delegates_to: z.optional(z.array(z.string())),
  accepts_from: z.optional(z.array(z.string())),
});

export const OpenCodeAgentRegistrySchema = z.object({
  agents: z.array(OpenCodeAgentRegistryEntrySchema),
  workflow_patterns: z.optional(z.record(z.string(), z.array(z.string()))),
  governance_chain: z.optional(z.array(z.string())),
  mcp_servers: z.optional(z.record(z.string(), z.any())),
  metadata: z.optional(
    z.object({
      version: z.optional(z.string()),
      created: z.optional(z.string()),
      total_agents: z.optional(z.number()),
      governance_agents: z.optional(z.number()),
      execution_agents: z.optional(z.number()),
      categories: z.optional(z.array(z.string())),
    }),
  ),
});

export type OpenCodeAgentRegistryEntry = z.infer<typeof OpenCodeAgentRegistryEntrySchema>;
export type OpenCodeAgentRegistry = z.infer<typeof OpenCodeAgentRegistrySchema>;
