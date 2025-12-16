import { basename, join } from "node:path";
import { z } from "zod/mini";
import { AiFile } from "../../types/ai-file.js";
import { FeatureProcessor } from "../../types/feature-processor.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { ToolFile } from "../../types/tool-file.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import {
  directoryExists,
  findFilesByGlobs,
  listDirectoryFiles,
  readJsonFile,
} from "../../utils/file.js";
import { logger } from "../../utils/logger.js";
import { AgentsmdSubagent } from "./agentsmd-subagent.js";
import { ClaudecodeSubagent } from "./claudecode-subagent.js";
import { CodexCliSubagent } from "./codexcli-subagent.js";
import { CopilotSubagent } from "./copilot-subagent.js";
import { CursorSubagent } from "./cursor-subagent.js";
import { GeminiCliSubagent } from "./geminicli-subagent.js";
import type {
  OpenCodeAgentRegistry,
  OpenCodeAgentRegistryEntry,
} from "./opencode-agent-registry.js";
import { OpenCodeRegistryManager } from "./opencode-registry-manager.js";
import { OpenCodeSubagent } from "./opencode-subagent.js";
import { RooSubagent } from "./roo-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import { SimulatedSubagent } from "./simulated-subagent.js";
import {
  ToolSubagent,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/**
 * Factory entry for each tool subagent class.
 * Stores the class reference and metadata for a tool.
 */
type ToolSubagentFactory = {
  class: {
    isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean;
    fromRulesyncSubagent(params: ToolSubagentFromRulesyncSubagentParams): ToolSubagent;
    fromFile(params: ToolSubagentFromFileParams): Promise<ToolSubagent>;
    getSettablePaths(options?: { global?: boolean }): ToolSubagentSettablePaths;
  };
  meta: {
    /** Whether the tool supports simulated subagents (embedded in rules) */
    supportsSimulated: boolean;
    /** Whether the tool supports global (user-level) subagents */
    supportsGlobal: boolean;
  };
};

/**
 * Supported tool targets for SubagentsProcessor.
 * Using a tuple to preserve order for consistent iteration.
 */
const subagentsProcessorToolTargetTuple = [
  "agentsmd",
  "claudecode",
  "codexcli",
  "copilot",
  "cursor",
  "geminicli",
  "opencode",
  "roo",
] as const;

export type SubagentsProcessorToolTarget = (typeof subagentsProcessorToolTargetTuple)[number];

// Schema for runtime validation
export const SubagentsProcessorToolTargetSchema = z.enum(subagentsProcessorToolTargetTuple);

/**
 * Factory Map mapping tool targets to their subagent factories.
 * Using Map to preserve insertion order for consistent iteration.
 */
const toolSubagentFactories = new Map<SubagentsProcessorToolTarget, ToolSubagentFactory>([
  [
    "agentsmd",
    { class: AgentsmdSubagent, meta: { supportsSimulated: true, supportsGlobal: false } },
  ],
  [
    "claudecode",
    { class: ClaudecodeSubagent, meta: { supportsSimulated: false, supportsGlobal: true } },
  ],
  [
    "codexcli",
    { class: CodexCliSubagent, meta: { supportsSimulated: true, supportsGlobal: false } },
  ],
  ["copilot", { class: CopilotSubagent, meta: { supportsSimulated: true, supportsGlobal: false } }],
  ["cursor", { class: CursorSubagent, meta: { supportsSimulated: true, supportsGlobal: false } }],
  [
    "geminicli",
    { class: GeminiCliSubagent, meta: { supportsSimulated: true, supportsGlobal: false } },
  ],
  [
    "opencode",
    { class: OpenCodeSubagent, meta: { supportsSimulated: false, supportsGlobal: false } },
  ],
  ["roo", { class: RooSubagent, meta: { supportsSimulated: true, supportsGlobal: false } }],
]);

/**
 * Factory retrieval function type for dependency injection.
 * Allows injecting custom factory implementations for testing purposes.
 */
type GetFactory = (target: SubagentsProcessorToolTarget) => ToolSubagentFactory;

const defaultGetFactory: GetFactory = (target) => {
  const factory = toolSubagentFactories.get(target);
  if (!factory) {
    throw new Error(`Unsupported tool target: ${target}`);
  }
  return factory;
};

// Derive tool target arrays from factory metadata
const allToolTargetKeys = [...toolSubagentFactories.keys()];

export const subagentsProcessorToolTargets: ToolTarget[] = allToolTargetKeys;

export const subagentsProcessorToolTargetsSimulated: ToolTarget[] = allToolTargetKeys.filter(
  (target) => {
    const factory = toolSubagentFactories.get(target);
    return factory?.meta.supportsSimulated ?? false;
  },
);

export const subagentsProcessorToolTargetsGlobal: ToolTarget[] = allToolTargetKeys.filter(
  (target) => {
    const factory = toolSubagentFactories.get(target);
    return factory?.meta.supportsGlobal ?? false;
  },
);

export class SubagentsProcessor extends FeatureProcessor {
  private readonly toolTarget: SubagentsProcessorToolTarget;
  private readonly global: boolean;
  private readonly getFactory: GetFactory;

  constructor({
    baseDir = process.cwd(),
    toolTarget,
    global = false,
    getFactory = defaultGetFactory,
  }: {
    baseDir?: string;
    toolTarget: ToolTarget;
    global?: boolean;
    getFactory?: GetFactory;
  }) {
    super({ baseDir });
    const result = SubagentsProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for SubagentsProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.global = global;
    this.getFactory = getFactory;
  }

  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncSubagents = rulesyncFiles.filter(
      (file): file is RulesyncSubagent => file instanceof RulesyncSubagent,
    );

    const factory = this.getFactory(this.toolTarget);

    const toolSubagents = rulesyncSubagents
      .map((rulesyncSubagent) => {
        if (!factory.class.isTargetedByRulesyncSubagent(rulesyncSubagent)) {
          return null;
        }
        return factory.class.fromRulesyncSubagent({
          baseDir: this.baseDir,
          relativeDirPath: RulesyncSubagent.getSettablePaths().relativeDirPath,
          rulesyncSubagent: rulesyncSubagent,
          global: this.global,
        });
      })
      .filter((subagent): subagent is ToolSubagent => subagent !== null);

    return toolSubagents;
  }

  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    const toolSubagents = toolFiles.filter(
      (file): file is ToolSubagent => file instanceof ToolSubagent,
    );

    const rulesyncSubagents: RulesyncSubagent[] = [];

    for (const toolSubagent of toolSubagents) {
      // Skip simulated subagents as they can't be converted back to rulesync
      if (toolSubagent instanceof SimulatedSubagent) {
        logger.debug(
          `Skipping simulated subagent conversion: ${toolSubagent.getRelativeFilePath()}`,
        );
        continue;
      }

      rulesyncSubagents.push(toolSubagent.toRulesyncSubagent());
    }

    return rulesyncSubagents;
  }

  /**
   * Implementation of abstract method from Processor
   * Load and parse rulesync subagent files from .rulesync/subagents/ directory
   */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    const subagentsDir = join(this.baseDir, RulesyncSubagent.getSettablePaths().relativeDirPath);

    // Check if directory exists
    const dirExists = await directoryExists(subagentsDir);
    if (!dirExists) {
      logger.debug(`Rulesync subagents directory not found: ${subagentsDir}`);
      return [];
    }

    // Read all markdown files from the directory
    const entries = await listDirectoryFiles(subagentsDir);
    const mdFiles = entries.filter((file) => file.endsWith(".md"));

    if (mdFiles.length === 0) {
      logger.debug(`No markdown files found in rulesync subagents directory: ${subagentsDir}`);
      return [];
    }

    logger.info(`Found ${mdFiles.length} subagent files in ${subagentsDir}`);

    // Parse all files and create RulesyncSubagent instances using fromFilePath
    const rulesyncSubagents: RulesyncSubagent[] = [];

    for (const mdFile of mdFiles) {
      const filepath = join(subagentsDir, mdFile);

      try {
        const rulesyncSubagent = await RulesyncSubagent.fromFile({
          relativeFilePath: mdFile,
          validate: true,
        });

        rulesyncSubagents.push(rulesyncSubagent);
        logger.debug(`Successfully loaded subagent: ${mdFile}`);
      } catch (error) {
        logger.warn(`Failed to load subagent file ${filepath}:`, error);
        continue;
      }
    }

    if (rulesyncSubagents.length === 0) {
      logger.debug(`No valid subagents found in ${subagentsDir}`);
      return [];
    }

    logger.info(`Successfully loaded ${rulesyncSubagents.length} rulesync subagents`);
    return rulesyncSubagents;
  }

  private validateRegistryEntry(entry: unknown): entry is OpenCodeAgentRegistryEntry {
    if (!entry || typeof entry !== "object") {
      return false;
    }
    const e = entry as Record<string, unknown>;

    if (typeof e.slug !== "string" || e.slug.length === 0) {
      return false;
    }
    if (typeof e.name !== "string" || e.name.length === 0) {
      return false;
    }
    if (typeof e.file !== "string" || e.file.length === 0) {
      return false;
    }
    if (typeof e.category !== "string") {
      return false;
    }

    if (e.capabilities !== undefined && !Array.isArray(e.capabilities)) {
      return false;
    }
    if (e.mcp_servers !== undefined && !Array.isArray(e.mcp_servers)) {
      return false;
    }
    if (e.delegates_to !== undefined && !Array.isArray(e.delegates_to)) {
      return false;
    }
    if (e.accepts_from !== undefined && !Array.isArray(e.accepts_from)) {
      return false;
    }

    if (
      Array.isArray(e.capabilities) &&
      !e.capabilities.every((item) => typeof item === "string")
    ) {
      return false;
    }
    if (Array.isArray(e.mcp_servers) && !e.mcp_servers.every((item) => typeof item === "string")) {
      return false;
    }
    if (
      Array.isArray(e.delegates_to) &&
      !e.delegates_to.every((item) => typeof item === "string")
    ) {
      return false;
    }
    if (
      Array.isArray(e.accepts_from) &&
      !e.accepts_from.every((item) => typeof item === "string")
    ) {
      return false;
    }

    return true;
  }

  private async loadOpenCodeAgentFiles(): Promise<ToolFile[]> {
    const registryPath = join(this.baseDir, ".opencode", "agent", "registry.json");

    try {
      const registryData = await readJsonFile<OpenCodeAgentRegistry>(registryPath);

      if (!registryData || !Array.isArray(registryData.agents)) {
        logger.warn(
          `Invalid registry.json structure at ${registryPath}: missing or invalid 'agents' array`,
        );
        return [];
      }

      const registry = registryData as OpenCodeAgentRegistry;
      const agentSubagents: ToolFile[] = [];

      for (const agentEntry of registry.agents) {
        if (!this.validateRegistryEntry(agentEntry)) {
          logger.warn(
            `Invalid registry entry structure at ${registryPath}: entry missing required fields or has invalid structure. Skipping.`,
          );
          continue;
        }

        try {
          const agentSubagent = await OpenCodeSubagent.fromAgent({
            baseDir: this.baseDir,
            agentEntry,
            validate: true,
          });
          agentSubagents.push(agentSubagent);
        } catch (error) {
          logger.warn(
            `Failed to load agent file ${agentEntry.file}: ${formatError(error)}. Skipping.`,
          );
        }
      }

      logger.debug(`Loaded ${agentSubagents.length} agent files from registry.json`);
      return agentSubagents;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        logger.debug(`Registry.json not found at ${registryPath}. Skipping agent loading.`);
        return [];
      }
      logger.warn(`Failed to load OpenCode agent registry: ${formatError(error)}`);
      return [];
    }
  }

  /**
   * Implementation of abstract method from Processor
   * Load tool-specific subagent configurations and parse them into ToolSubagent instances
   */
  async loadToolFiles({
    forDeletion = false,
  }: {
    forDeletion?: boolean;
  } = {}): Promise<ToolFile[]> {
    if (this.toolTarget === "opencode") {
      const agentSubagents = await this.loadOpenCodeAgentFiles();
      logger.debug(`Found ${agentSubagents.length} agent files from registry`);

      const result = forDeletion
        ? agentSubagents.filter((subagent) => subagent.isDeletable())
        : agentSubagents;

      return result;
    }

    const factory = this.getFactory(this.toolTarget);
    const paths = factory.class.getSettablePaths({ global: this.global });

    const subagentFilePaths = await findFilesByGlobs(
      join(this.baseDir, paths.relativeDirPath, "*.md"),
    );

    const toolSubagents = await Promise.all(
      subagentFilePaths.map((path) =>
        factory.class.fromFile({
          baseDir: this.baseDir,
          relativeFilePath: basename(path),
          global: this.global,
        }),
      ),
    );

    const result = forDeletion
      ? toolSubagents.filter((subagent) => subagent.isDeletable())
      : toolSubagents;

    logger.info(`Successfully loaded ${result.length} ${paths.relativeDirPath} subagents`);
    return result;
  }

  async writeAiFiles(aiFiles: AiFile[]): Promise<number> {
    const writtenCount = await super.writeAiFiles(aiFiles);

    if (this.toolTarget === "opencode") {
      try {
        const agentSubagents = aiFiles.filter((file): file is OpenCodeSubagent => {
          if (!(file instanceof OpenCodeSubagent)) {
            return false;
          }
          return file.getAgentEntry() !== undefined;
        });

        if (agentSubagents.length > 0) {
          const registryManager = new OpenCodeRegistryManager(this.baseDir);
          await registryManager.updateAndWriteRegistry(agentSubagents);
          logger.debug(`Updated registry.json with ${agentSubagents.length} agent entries`);
        }
      } catch (error) {
        logger.warn(`Failed to update registry.json: ${formatError(error)}`);
      }
    }

    return writtenCount;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets({
    global = false,
    includeSimulated = false,
  }: {
    global?: boolean;
    includeSimulated?: boolean;
  } = {}): ToolTarget[] {
    if (global) {
      return [...subagentsProcessorToolTargetsGlobal];
    }
    if (!includeSimulated) {
      return subagentsProcessorToolTargets.filter(
        (target) => !subagentsProcessorToolTargetsSimulated.includes(target),
      );
    }
    return [...subagentsProcessorToolTargets];
  }

  static getToolTargetsSimulated(): ToolTarget[] {
    return [...subagentsProcessorToolTargetsSimulated];
  }
}
