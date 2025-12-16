import { join } from "node:path";
import { ensureDir, readJsonFile, writeJsonFile } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import type {
  OpenCodeAgentRegistry,
  OpenCodeAgentRegistryEntry,
} from "./opencode-agent-registry.js";
import type { OpenCodeSubagent } from "./opencode-subagent.js";

export class OpenCodeRegistryManager {
  private readonly baseDir: string;
  private readonly registryPath: string;

  constructor(baseDir: string = process.cwd()) {
    this.baseDir = baseDir;
    this.registryPath = join(baseDir, ".opencode", "agent", "registry.json");
  }

  async readRegistry(): Promise<OpenCodeAgentRegistry> {
    try {
      const registry = await readJsonFile<OpenCodeAgentRegistry>(this.registryPath);
      if (!registry || !Array.isArray(registry.agents)) {
        logger.warn(
          `Invalid registry.json structure at ${this.registryPath}, returning empty registry`,
        );
        return { agents: [] };
      }
      return registry;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        logger.debug(`Registry.json not found at ${this.registryPath}, will create new one`);
        return { agents: [] };
      }
      logger.warn(`Failed to read registry.json: ${error}`);
      return { agents: [] };
    }
  }

  async updateRegistry(agentSubagents: OpenCodeSubagent[]): Promise<OpenCodeAgentRegistry> {
    const existingRegistry = await this.readRegistry();

    const newAgentEntries: OpenCodeAgentRegistryEntry[] = [];
    for (const subagent of agentSubagents) {
      const agentEntry = subagent.getAgentEntry();
      if (!agentEntry) {
        continue;
      }

      const category = agentEntry.category !== undefined ? agentEntry.category : "";

      const filePath =
        category && category.length > 0
          ? `.opencode/agent/${category}/${agentEntry.slug}.md`
          : `.opencode/agent/${agentEntry.slug}.md`;

      const frontmatter = subagent.getFrontmatter();
      const entry: OpenCodeAgentRegistryEntry = {
        slug: agentEntry.slug,
        name: agentEntry.name || frontmatter.description || agentEntry.slug,
        file: filePath,
        category: category,
        capabilities: agentEntry.capabilities,
        mcp_servers: agentEntry.mcp_servers,
        delegates_to: agentEntry.delegates_to,
        accepts_from: agentEntry.accepts_from,
      };

      newAgentEntries.push(entry);
    }

    const updatedRegistry: OpenCodeAgentRegistry = {
      agents: newAgentEntries,
      workflow_patterns: existingRegistry.workflow_patterns,
      governance_chain: existingRegistry.governance_chain,
      mcp_servers: existingRegistry.mcp_servers,
      metadata: existingRegistry.metadata,
    };

    return updatedRegistry;
  }

  async writeRegistry(registry: OpenCodeAgentRegistry): Promise<void> {
    try {
      await ensureDir(join(this.baseDir, ".opencode", "agent"));
      await writeJsonFile(this.registryPath, registry);
      logger.debug(
        `Updated registry.json at ${this.registryPath} with ${registry.agents.length} agents`,
      );
    } catch (error) {
      logger.error(`Failed to write registry.json: ${error}`);
      throw new Error(`Failed to write registry.json: ${error}`, { cause: error });
    }
  }

  async updateAndWriteRegistry(agentSubagents: OpenCodeSubagent[]): Promise<void> {
    const updatedRegistry = await this.updateRegistry(agentSubagents);
    await this.writeRegistry(updatedRegistry);
  }
}
