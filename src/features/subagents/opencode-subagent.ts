import { join } from "node:path";
import { z } from "zod/mini";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { checkPathTraversal, readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { logger } from "../../utils/logger.js";
import type { OpenCodeAgentRegistryEntry } from "./opencode-agent-registry.js";
import { RulesyncSubagent, RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

export const OpenCodeSubagentFrontmatterSchema = z.looseObject({
  name: z.optional(z.string()),
  description: z.string(),
  mode: z.optional(z.string()),
  model: z.optional(z.string()),
  temperature: z.optional(z.number()),
  topP: z.optional(z.number()),
  tools: z.optional(z.any()),
  permission: z.optional(z.any()),
  color: z.optional(z.string()),
  maxSteps: z.optional(z.number()),
  options: z.optional(z.any()),
});

export type OpenCodeSubagentFrontmatter = z.infer<typeof OpenCodeSubagentFrontmatterSchema>;

export type OpenCodeSubagentParams = {
  frontmatter: OpenCodeSubagentFrontmatter;
  body: string;
  agentEntry?: OpenCodeAgentRegistryEntry;
} & AiFileParams;

export type OpenCodeSubagentFromAgentParams = {
  baseDir?: string;
  agentEntry: OpenCodeAgentRegistryEntry;
  validate?: boolean;
};

export class OpenCodeSubagent extends ToolSubagent {
  private readonly frontmatter: OpenCodeSubagentFrontmatter;
  private readonly body: string;
  private readonly agentEntry?: OpenCodeAgentRegistryEntry;

  constructor({ frontmatter, body, agentEntry, ...rest }: OpenCodeSubagentParams) {
    if (rest.validate !== false) {
      const result = OpenCodeSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
    });

    this.frontmatter = frontmatter;
    this.body = body;
    this.agentEntry = agentEntry;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: join(".opencode", "agent"),
    };
  }

  getFrontmatter(): OpenCodeSubagentFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  getAgentEntry(): OpenCodeAgentRegistryEntry | undefined {
    return this.agentEntry;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const { description, ...restFields } = this.frontmatter;

    const opencodeSection: Record<string, unknown> = {
      ...restFields,
    };

    if (this.agentEntry) {
      if (this.agentEntry.category !== undefined) {
        opencodeSection.category = this.agentEntry.category;
      } else {
        const pathParts = this.getRelativeFilePath().split("/");
        if (pathParts.length > 1) {
          opencodeSection.category = pathParts[0];
        } else {
          opencodeSection.category = "";
        }
      }
      if (this.agentEntry.capabilities && this.agentEntry.capabilities.length > 0) {
        opencodeSection.capabilities = this.agentEntry.capabilities;
      }
      if (this.agentEntry.mcp_servers && this.agentEntry.mcp_servers.length > 0) {
        opencodeSection.mcp_servers = this.agentEntry.mcp_servers;
      }
      if (this.agentEntry.delegates_to && this.agentEntry.delegates_to.length > 0) {
        opencodeSection.delegates_to = this.agentEntry.delegates_to;
      }
      if (this.agentEntry.accepts_from && this.agentEntry.accepts_from.length > 0) {
        opencodeSection.accepts_from = this.agentEntry.accepts_from;
      }
    }

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["opencode"] as const,
      name: this.agentEntry?.slug || this.getRelativeFilePath().replace(/\.md$/, ""),
      description: description || this.agentEntry?.name || "",
      ...(Object.keys(opencodeSection).length > 0 && { opencode: opencodeSection }),
    };

    return new RulesyncSubagent({
      baseDir: ".",
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.agentEntry?.slug || this.getRelativeFilePath(),
      validate: true,
    });
  }

  static fromRulesyncSubagent({
    baseDir = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const opencodeSection = rulesyncFrontmatter.opencode ?? {};

    const category = (opencodeSection.category as string | undefined) ?? "";
    const slug = rulesyncSubagent.getRelativeFilePath().replace(/\.md$/, "");
    const relativeFilePath =
      category && category.length > 0 ? `${category}/${slug}.md` : `${slug}.md`;

    const agentFrontmatter: Record<string, unknown> = {};

    const registryFields = [
      "category",
      "capabilities",
      "mcp_servers",
      "delegates_to",
      "accepts_from",
    ];
    for (const [key, value] of Object.entries(opencodeSection)) {
      if (!registryFields.includes(key) && value !== undefined) {
        agentFrontmatter[key] = value;
      }
    }

    if (rulesyncFrontmatter.description) {
      agentFrontmatter.description = rulesyncFrontmatter.description;
    }

    const result = OpenCodeSubagentFrontmatterSchema.safeParse(agentFrontmatter);
    if (!result.success) {
      throw new Error(`Invalid opencode subagent frontmatter: ${formatError(result.error)}`);
    }

    const opencodeFrontmatter = result.data;

    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, opencodeFrontmatter);

    const paths = this.getSettablePaths({ global });

    const agentEntry: OpenCodeAgentRegistryEntry | undefined =
      opencodeSection.category !== undefined ||
      opencodeSection.capabilities ||
      opencodeSection.mcp_servers ||
      opencodeSection.delegates_to ||
      opencodeSection.accepts_from
        ? {
            slug,
            name: rulesyncFrontmatter.description || slug,
            file: `.opencode/agent/${relativeFilePath}`,
            category: category && category.length > 0 ? category : "",
            capabilities: opencodeSection.capabilities as string[] | undefined,
            mcp_servers: opencodeSection.mcp_servers as string[] | undefined,
            delegates_to: opencodeSection.delegates_to as string[] | undefined,
            accepts_from: opencodeSection.accepts_from as string[] | undefined,
          }
        : undefined;

    return new OpenCodeSubagent({
      baseDir: baseDir,
      frontmatter: opencodeFrontmatter,
      body,
      agentEntry,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: relativeFilePath,
      fileContent,
      validate,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = OpenCodeSubagentFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
        ),
      };
    }
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "opencode",
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<OpenCodeSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    const result = OpenCodeSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new OpenCodeSubagent({
      baseDir: baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate,
    });
  }

  static async fromAgent({
    baseDir = process.cwd(),
    agentEntry,
    validate = true,
  }: OpenCodeSubagentFromAgentParams): Promise<OpenCodeSubagent> {
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

    const { frontmatter, body } = parseFrontmatter(fileContent);

    const result = OpenCodeSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${agentFilePath}: ${formatError(result.error)}`);
    }

    return new OpenCodeSubagent({
      baseDir,
      relativeDirPath: join(".opencode", "agent"),
      relativeFilePath,
      validate,
      fileContent,
      frontmatter: result.data,
      body,
      agentEntry,
    });
  }
}
