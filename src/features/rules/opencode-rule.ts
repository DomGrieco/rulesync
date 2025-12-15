import { join } from "node:path";
import { type AiFileFromFileParams, ValidationResult } from "../../types/ai-file.js";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { checkPathTraversal, readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { logger } from "../../utils/logger.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  type ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  ToolRuleSettablePaths,
} from "./tool-rule.js";
import type { OpenCodeAgentRegistryEntry } from "./opencode-agent-registry.js";

export type OpenCodeRuleParams = ToolRuleParams & {
  agentEntry?: OpenCodeAgentRegistryEntry;
};

export type OpenCodeRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
};

/**
 * Parameters for creating an OpenCodeRule from an agent file
 */
export type OpenCodeRuleFromAgentParams = {
  baseDir?: string;
  agentEntry: OpenCodeAgentRegistryEntry;
  validate?: boolean;
};

export class OpenCodeRule extends ToolRule {
  private readonly agentEntry?: OpenCodeAgentRegistryEntry;

  constructor({ agentEntry, ...rest }: OpenCodeRuleParams) {
    super(rest);
    this.agentEntry = agentEntry;
  }

  static getSettablePaths(): OpenCodeRuleSettablePaths {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      },
      nonRoot: {
        relativeDirPath: join(".opencode", "memories"),
      },
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
  }: AiFileFromFileParams): Promise<OpenCodeRule> {
    const isRoot = relativeFilePath === "AGENTS.md";
    const relativePath = isRoot ? "AGENTS.md" : join(".opencode", "memories", relativeFilePath);
    const fileContent = await readFileContent(join(baseDir, relativePath));

    return new OpenCodeRule({
      baseDir,
      relativeDirPath: isRoot
        ? this.getSettablePaths().root.relativeDirPath
        : this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: isRoot ? "AGENTS.md" : relativeFilePath,
      validate,
      root: isRoot,
      fileContent,
    });
  }

  static async fromAgent({
    baseDir = process.cwd(),
    agentEntry,
    validate = true,
  }: OpenCodeRuleFromAgentParams): Promise<OpenCodeRule> {
    checkPathTraversal({
      relativePath: agentEntry.file,
      intendedRootDir: join(baseDir, ".opencode", "agent"),
    });
    
    const agentFilePath = join(baseDir, agentEntry.file);
    const fileContent = await readFileContent(agentFilePath);

    const pathParts = agentEntry.file.split("/");
    const filename = pathParts[pathParts.length - 1]?.replace(/\.md$/, "") || "";
    const potentialCategory = pathParts[pathParts.length - 2];
    const isRootLevel = potentialCategory === "agent" || !potentialCategory;
    const pathCategory = isRootLevel ? "" : potentialCategory;
    
    if (agentEntry.category !== undefined && agentEntry.category !== pathCategory) {
      logger.warn(
        `Category mismatch for agent ${agentEntry.slug}: registry category "${agentEntry.category}" doesn't match path category "${pathCategory}". Using registry category.`,
      );
    }
    
    const category = agentEntry.category !== undefined ? agentEntry.category : pathCategory;
    const slug = filename;
    const relativeFilePath = category ? `${category}/${slug}.md` : `${slug}.md`;

    return new OpenCodeRule({
      baseDir,
      relativeDirPath: join(".opencode", "agent"),
      relativeFilePath,
      validate,
      root: false,
      fileContent,
      description: agentEntry.name,
      agentEntry,
    });
  }

  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): OpenCodeRule {
    const frontmatter = rulesyncRule.getFrontmatter();
    const opencodeMetadata = frontmatter.opencode;

    // Check if this is an agent file (stored in subagents directory)
    // Agents can have category (categorized) or be root-level (no category)
    if (
      opencodeMetadata &&
      typeof opencodeMetadata === "object" &&
      rulesyncRule.getRelativeDirPath() === RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH
    ) {
      // This is an agent file - convert it back to OpenCode agent format
      // Category can be a string (categorized) or empty string/undefined (root-level)
      const category = (opencodeMetadata.category as string | undefined) ?? "";
      const slug = rulesyncRule.getRelativeFilePath().replace(/\.md$/, "");
      // For root-level agents (empty category), use just the slug
      // For categorized agents, use category/slug format
      const relativeFilePath = category && category.length > 0 ? `${category}/${slug}.md` : `${slug}.md`;

      // Reconstruct OpenCode agent frontmatter from rulesync frontmatter
      // Preserve all frontmatter fields from opencode metadata
      const agentFrontmatter: Record<string, unknown> = {};
      
      // Copy all frontmatter fields from opencode metadata, excluding registry-specific fields
      const registryFields = ["category", "capabilities", "mcp_servers", "delegates_to", "accepts_from"];
      for (const [key, value] of Object.entries(opencodeMetadata)) {
        if (!registryFields.includes(key) && value !== undefined) {
          agentFrontmatter[key] = value;
        }
      }

      // Add description if present
      if (frontmatter.description) {
        agentFrontmatter.description = frontmatter.description;
      }

      // Reconstruct file content with OpenCode frontmatter
      const body = rulesyncRule.getBody();
      const fileContent = stringifyFrontmatter(body, agentFrontmatter);

      return new OpenCodeRule({
        baseDir,
        relativeDirPath: join(".opencode", "agent"),
        relativeFilePath,
        validate,
        root: false,
        fileContent,
        description: frontmatter.description,
        // Reconstruct agentEntry from metadata for reference
        agentEntry: {
          slug,
          name: (frontmatter.description as string) || slug,
          file: `.opencode/agent/${relativeFilePath}`,
          category: category && category.length > 0 ? category : undefined,
          capabilities: opencodeMetadata.capabilities as string[] | undefined,
          mcp_servers: opencodeMetadata.mcp_servers as string[] | undefined,
          delegates_to: opencodeMetadata.delegates_to as string[] | undefined,
          accepts_from: opencodeMetadata.accepts_from as string[] | undefined,
        },
      });
    }

    // Regular rule file (root or memory) - use default conversion
    return new OpenCodeRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: this.getSettablePaths().root,
        nonRootPath: this.getSettablePaths().nonRoot,
      }),
    );
  }

  toRulesyncRule(): RulesyncRule {
    // For agent files, we want to preserve the frontmatter metadata
    // Parse the file content to extract frontmatter and body
    const { frontmatter, body } = parseFrontmatter(this.getFileContent());

    // Create rulesync rule with agent metadata in frontmatter
    const rulesyncFrontmatter: Record<string, unknown> = {
      root: this.isRoot(),
      targets: ["opencode"],
      description: this.description ?? frontmatter.description ?? "",
    };

    // Preserve agent-specific frontmatter fields and registry metadata
    // Only populate opencodeMetadata if this is an agent file (has agentEntry)
    const opencodeMetadata: Record<string, unknown> = {};

    // Only add frontmatter fields if this is an agent file
    if (this.agentEntry) {
      // Add frontmatter fields if present
      if (frontmatter.mode) {
        opencodeMetadata.mode = frontmatter.mode;
      }
      if (frontmatter.model) {
        opencodeMetadata.model = frontmatter.model;
      }
      if (frontmatter.temperature !== undefined) {
        opencodeMetadata.temperature = frontmatter.temperature;
      }
      if (frontmatter.topP !== undefined) {
        opencodeMetadata.topP = frontmatter.topP;
      }
      if (frontmatter.tools) {
        opencodeMetadata.tools = frontmatter.tools;
      }
      if (frontmatter.color) {
        opencodeMetadata.color = frontmatter.color;
      }
      if (frontmatter.maxSteps !== undefined) {
        opencodeMetadata.maxSteps = frontmatter.maxSteps;
      }
      if (frontmatter.permission) {
        opencodeMetadata.permission = frontmatter.permission;
      }
      if (frontmatter.options) {
        opencodeMetadata.options = frontmatter.options;
      }

      // Add registry metadata
      // Include category even if empty (to distinguish root-level agents)
      // Root-level agents will have category: "" or undefined
      if (this.agentEntry.category !== undefined) {
        // Preserve empty string for root-level agents
        opencodeMetadata.category = this.agentEntry.category;
      } else {
        // Try to extract category from relativeFilePath if not in agentEntry
        // e.g., "governance/context-steward.md" -> category: "governance"
        // e.g., "my-agent.md" -> category: "" (root-level)
        const pathParts = this.getRelativeFilePath().split("/");
        if (pathParts.length > 1) {
          opencodeMetadata.category = pathParts[0];
        } else {
          // Empty string indicates root-level agent
          opencodeMetadata.category = "";
        }
      }
      if (this.agentEntry.capabilities && this.agentEntry.capabilities.length > 0) {
        opencodeMetadata.capabilities = this.agentEntry.capabilities;
      }
      if (this.agentEntry.mcp_servers && this.agentEntry.mcp_servers.length > 0) {
        opencodeMetadata.mcp_servers = this.agentEntry.mcp_servers;
      }
      if (this.agentEntry.delegates_to && this.agentEntry.delegates_to.length > 0) {
        opencodeMetadata.delegates_to = this.agentEntry.delegates_to;
      }
      if (this.agentEntry.accepts_from && this.agentEntry.accepts_from.length > 0) {
        opencodeMetadata.accepts_from = this.agentEntry.accepts_from;
      }
    }

    // Only add opencode field if this is an agent file (has agentEntry)
    // For non-agent files (no agentEntry), don't add opencode metadata
    // This prevents adding opencode metadata to regular rules that happen to have frontmatter fields
    if (this.agentEntry && Object.keys(opencodeMetadata).length > 0) {
      rulesyncFrontmatter.opencode = opencodeMetadata;
    }

    // For agent files (with agentEntry), save to subagents directory instead of rules
    // Agent definitions are conceptually similar to subagents, not rules
    // Subagents are stored flat (just filename.md), not in category subdirectories
    const relativeDirPath = this.agentEntry
      ? RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH
      : ".rulesync/rules";

    // For agents, use just the slug as filename (flatten category structure)
    // Category is preserved in the opencode metadata
    const relativeFilePath = this.agentEntry
      ? `${this.agentEntry.slug}.md`
      : this.isRoot()
        ? "AGENTS.md"
        : this.getRelativeFilePath();

    return new RulesyncRule({
      baseDir: this.baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: rulesyncFrontmatter,
      body,
    });
  }

  validate(): ValidationResult {
    // OpenCode rules are always valid since they use plain markdown format
    // Similar to AgentsMdRule, no complex frontmatter validation needed
    return { success: true, error: null };
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "opencode",
    });
  }
}
