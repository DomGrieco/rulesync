import { basename, join } from "node:path";
import { encode } from "@toon-format/toon";
import { z } from "zod/mini";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import {
  RULESYNC_COMMANDS_RELATIVE_DIR_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { FeatureProcessor } from "../../types/feature-processor.js";
import { AiFile } from "../../types/ai-file.js";
import { RulesyncFile } from "../../types/rulesync-file.js";
import { ToolFile } from "../../types/tool-file.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { findFilesByGlobs, readFileContent, readJsonFile } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { logger } from "../../utils/logger.js";
import { AgentsmdCommand } from "../commands/agentsmd-command.js";
import { CommandsProcessor } from "../commands/commands-processor.js";
import { CopilotCommand } from "../commands/copilot-command.js";
import { CursorCommand } from "../commands/cursor-command.js";
import { GeminiCliCommand } from "../commands/geminicli-command.js";
import { RooCommand } from "../commands/roo-command.js";
import { AgentsmdSkill } from "../skills/agentsmd-skill.js";
import { CodexCliSkill } from "../skills/codexcli-skill.js";
import { CopilotSkill } from "../skills/copilot-skill.js";
import { CursorSkill } from "../skills/cursor-skill.js";
import { GeminiCliSkill } from "../skills/geminicli-skill.js";
import { RulesyncSkill } from "../skills/rulesync-skill.js";
import { SkillsProcessor } from "../skills/skills-processor.js";
import { AgentsmdSubagent } from "../subagents/agentsmd-subagent.js";
import { CodexCliSubagent } from "../subagents/codexcli-subagent.js";
import { CopilotSubagent } from "../subagents/copilot-subagent.js";
import { CursorSubagent } from "../subagents/cursor-subagent.js";
import { GeminiCliSubagent } from "../subagents/geminicli-subagent.js";
import { RooSubagent } from "../subagents/roo-subagent.js";
import { SubagentsProcessor } from "../subagents/subagents-processor.js";
import { AgentsMdRule } from "./agentsmd-rule.js";
import { AmazonQCliRule } from "./amazonqcli-rule.js";
import { AntigravityRule } from "./antigravity-rule.js";
import { AugmentcodeLegacyRule } from "./augmentcode-legacy-rule.js";
import { AugmentcodeRule } from "./augmentcode-rule.js";
import { ClaudecodeLegacyRule } from "./claudecode-legacy-rule.js";
import { ClaudecodeRule } from "./claudecode-rule.js";
import { ClineRule } from "./cline-rule.js";
import { CodexcliRule } from "./codexcli-rule.js";
import { CopilotRule } from "./copilot-rule.js";
import { CursorRule } from "./cursor-rule.js";
import { GeminiCliRule } from "./geminicli-rule.js";
import { JunieRule } from "./junie-rule.js";
import { KiroRule } from "./kiro-rule.js";
import { OpenCodeRule } from "./opencode-rule.js";
import type {
  OpenCodeAgentRegistry,
  OpenCodeAgentRegistryEntry,
} from "./opencode-agent-registry.js";
import { OpenCodeRegistryManager } from "./opencode-registry-manager.js";
import { QwencodeRule } from "./qwencode-rule.js";
import { RooRule } from "./roo-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
  ToolRuleSettablePathsGlobal,
} from "./tool-rule.js";
import { WarpRule } from "./warp-rule.js";
import { WindsurfRule } from "./windsurf-rule.js";

const rulesProcessorToolTargets: ToolTarget[] = [
  "agentsmd",
  "amazonqcli",
  "antigravity",
  "augmentcode",
  "augmentcode-legacy",
  "claudecode",
  "claudecode-legacy",
  "cline",
  "codexcli",
  "copilot",
  "cursor",
  "geminicli",
  "junie",
  "kiro",
  "opencode",
  "qwencode",
  "roo",
  "warp",
  "windsurf",
];
export const RulesProcessorToolTargetSchema = z.enum(rulesProcessorToolTargets);
export type RulesProcessorToolTarget = z.infer<typeof RulesProcessorToolTargetSchema>;

/**
 * Rule discovery mode for determining how non-root rules are referenced.
 * - `auto`: Tool auto-discovers rules in a directory, no reference section needed
 * - `toon`: Tool requires explicit references using TOON format
 * - `claudecode-legacy`: Uses Claude Code specific reference format (legacy mode only)
 */
type RuleDiscoveryMode = "auto" | "toon" | "claudecode-legacy";

/**
 * Type for command class that provides settable paths.
 */
type CommandClassType = {
  getSettablePaths: (options?: { global?: boolean }) => { relativeDirPath: string };
};

/**
 * Type for subagent class that provides settable paths.
 */
type SubagentClassType = {
  getSettablePaths: (options?: { global?: boolean }) => { relativeDirPath: string };
};

/**
 * Type for skill class that can be used to build skill list.
 */
type SkillClassType = {
  isTargetedByRulesyncSkill: (rulesyncSkill: RulesyncSkill) => boolean;
  getSettablePaths: (options?: { global?: boolean }) => { relativeDirPath: string };
};

/**
 * Configuration for additional conventions (simulated features).
 * Specifies which simulated features are supported for the tool and their paths.
 */
type AdditionalConventionsConfig = {
  /** Command feature configuration */
  commands?: {
    commandClass: CommandClassType;
  };
  /** Subagent feature configuration */
  subagents?: {
    subagentClass: SubagentClassType;
  };
  /** Skill feature configuration */
  skills?: {
    skillClass: SkillClassType;
    /** Whether skills are only supported in global mode */
    globalOnly?: boolean;
  };
};

/**
 * Factory entry for each tool rule class.
 * Stores the class reference and metadata for a tool.
 */
type ToolRuleFactory = {
  class: {
    isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean;
    fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): ToolRule;
    fromFile(params: ToolRuleFromFileParams): Promise<ToolRule>;
    getSettablePaths(options?: {
      global?: boolean;
    }): ToolRuleSettablePaths | ToolRuleSettablePathsGlobal;
  };
  meta: {
    /** File extension for the rule file */
    extension: "md" | "mdc";
    /** Whether this tool supports global (user scope) mode */
    supportsGlobal: boolean;
    /** How non-root rules are discovered or referenced */
    ruleDiscoveryMode: RuleDiscoveryMode;
    /** Configuration for additional conventions (simulated features) */
    additionalConventions?: AdditionalConventionsConfig;
    /** Whether to create a separate rule file for additional conventions instead of prepending to root */
    createsSeparateConventionsRule?: boolean;
  };
};

/**
 * Factory Map mapping tool targets to their rule factories.
 * Using Map to preserve insertion order for consistent iteration.
 */
const toolRuleFactories = new Map<RulesProcessorToolTarget, ToolRuleFactory>([
  [
    "agentsmd",
    {
      class: AgentsMdRule,
      meta: {
        extension: "md",
        supportsGlobal: false,
        ruleDiscoveryMode: "toon",
        additionalConventions: {
          commands: { commandClass: AgentsmdCommand },
          subagents: { subagentClass: AgentsmdSubagent },
          skills: { skillClass: AgentsmdSkill },
        },
      },
    },
  ],
  [
    "amazonqcli",
    {
      class: AmazonQCliRule,
      meta: { extension: "md", supportsGlobal: false, ruleDiscoveryMode: "auto" },
    },
  ],
  [
    "antigravity",
    {
      class: AntigravityRule,
      meta: { extension: "md", supportsGlobal: false, ruleDiscoveryMode: "auto" },
    },
  ],
  [
    "augmentcode",
    {
      class: AugmentcodeRule,
      meta: { extension: "md", supportsGlobal: false, ruleDiscoveryMode: "auto" },
    },
  ],
  [
    "augmentcode-legacy",
    {
      class: AugmentcodeLegacyRule,
      meta: { extension: "md", supportsGlobal: false, ruleDiscoveryMode: "toon" },
    },
  ],
  [
    "claudecode",
    {
      class: ClaudecodeRule,
      meta: { extension: "md", supportsGlobal: true, ruleDiscoveryMode: "auto" },
    },
  ],
  [
    "claudecode-legacy",
    {
      class: ClaudecodeLegacyRule,
      meta: { extension: "md", supportsGlobal: true, ruleDiscoveryMode: "claudecode-legacy" },
    },
  ],
  [
    "cline",
    {
      class: ClineRule,
      meta: { extension: "md", supportsGlobal: false, ruleDiscoveryMode: "auto" },
    },
  ],
  [
    "codexcli",
    {
      class: CodexcliRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "toon",
        additionalConventions: {
          subagents: { subagentClass: CodexCliSubagent },
          skills: { skillClass: CodexCliSkill, globalOnly: true },
        },
      },
    },
  ],
  [
    "copilot",
    {
      class: CopilotRule,
      meta: {
        extension: "md",
        supportsGlobal: false,
        ruleDiscoveryMode: "auto",
        additionalConventions: {
          commands: { commandClass: CopilotCommand },
          subagents: { subagentClass: CopilotSubagent },
          skills: { skillClass: CopilotSkill },
        },
      },
    },
  ],
  [
    "cursor",
    {
      class: CursorRule,
      meta: {
        extension: "mdc",
        supportsGlobal: false,
        ruleDiscoveryMode: "auto",
        additionalConventions: {
          commands: { commandClass: CursorCommand },
          subagents: { subagentClass: CursorSubagent },
          skills: { skillClass: CursorSkill },
        },
        createsSeparateConventionsRule: true,
      },
    },
  ],
  [
    "geminicli",
    {
      class: GeminiCliRule,
      meta: {
        extension: "md",
        supportsGlobal: true,
        ruleDiscoveryMode: "toon",
        additionalConventions: {
          commands: { commandClass: GeminiCliCommand },
          subagents: { subagentClass: GeminiCliSubagent },
          skills: { skillClass: GeminiCliSkill },
        },
      },
    },
  ],
  [
    "junie",
    {
      class: JunieRule,
      meta: { extension: "md", supportsGlobal: false, ruleDiscoveryMode: "toon" },
    },
  ],
  [
    "kiro",
    {
      class: KiroRule,
      meta: { extension: "md", supportsGlobal: false, ruleDiscoveryMode: "toon" },
    },
  ],
  [
    "opencode",
    {
      class: OpenCodeRule,
      meta: { extension: "md", supportsGlobal: false, ruleDiscoveryMode: "toon" },
    },
  ],
  [
    "qwencode",
    {
      class: QwencodeRule,
      meta: { extension: "md", supportsGlobal: false, ruleDiscoveryMode: "toon" },
    },
  ],
  [
    "roo",
    {
      class: RooRule,
      meta: {
        extension: "md",
        supportsGlobal: false,
        ruleDiscoveryMode: "auto",
        additionalConventions: {
          commands: { commandClass: RooCommand },
          subagents: { subagentClass: RooSubagent },
        },
        createsSeparateConventionsRule: true,
      },
    },
  ],
  [
    "warp",
    {
      class: WarpRule,
      meta: { extension: "md", supportsGlobal: false, ruleDiscoveryMode: "toon" },
    },
  ],
  [
    "windsurf",
    {
      class: WindsurfRule,
      meta: { extension: "md", supportsGlobal: false, ruleDiscoveryMode: "auto" },
    },
  ],
]);

/**
 * Tool targets that support global (user scope) mode.
 * Derived from the factory meta configuration.
 */
export const rulesProcessorToolTargetsGlobal: ToolTarget[] = Array.from(toolRuleFactories.entries())
  .filter(([_, factory]) => factory.meta.supportsGlobal)
  .map(([target]) => target);

/**
 * Factory retrieval function type for dependency injection.
 * Allows injecting custom factory implementations for testing purposes.
 */
type GetFactory = (target: RulesProcessorToolTarget) => ToolRuleFactory;

const defaultGetFactory: GetFactory = (target) => {
  const factory = toolRuleFactories.get(target);
  if (!factory) {
    throw new Error(`Unsupported tool target: ${target}`);
  }
  return factory;
};

export class RulesProcessor extends FeatureProcessor {
  private readonly toolTarget: RulesProcessorToolTarget;
  private readonly simulateCommands: boolean;
  private readonly simulateSubagents: boolean;
  private readonly simulateSkills: boolean;
  private readonly global: boolean;
  private readonly getFactory: GetFactory;
  private readonly skills?: RulesyncSkill[];

  constructor({
    baseDir = process.cwd(),
    toolTarget,
    simulateCommands = false,
    simulateSubagents = false,
    simulateSkills = false,
    global = false,
    getFactory = defaultGetFactory,
    skills,
  }: {
    baseDir?: string;
    toolTarget: ToolTarget;
    global?: boolean;
    simulateCommands?: boolean;
    simulateSubagents?: boolean;
    simulateSkills?: boolean;
    getFactory?: GetFactory;
    skills?: RulesyncSkill[];
  }) {
    super({ baseDir });
    const result = RulesProcessorToolTargetSchema.safeParse(toolTarget);
    if (!result.success) {
      throw new Error(
        `Invalid tool target for RulesProcessor: ${toolTarget}. ${formatError(result.error)}`,
      );
    }
    this.toolTarget = result.data;
    this.global = global;
    this.simulateCommands = simulateCommands;
    this.simulateSubagents = simulateSubagents;
    this.simulateSkills = simulateSkills;
    this.getFactory = getFactory;
    this.skills = skills;
  }

  async convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]> {
    const rulesyncRules = rulesyncFiles.filter(
      (file): file is RulesyncRule => file instanceof RulesyncRule,
    );

    const factory = this.getFactory(this.toolTarget);
    const { meta } = factory;

    const toolRules = rulesyncRules
      .map((rulesyncRule) => {
        if (!factory.class.isTargetedByRulesyncRule(rulesyncRule)) {
          return null;
        }
        return factory.class.fromRulesyncRule({
          baseDir: this.baseDir,
          rulesyncRule,
          validate: true,
          global: this.global,
        });
      })
      .filter((rule): rule is ToolRule => rule !== null);

    const isSimulated = this.simulateCommands || this.simulateSubagents || this.simulateSkills;

    // For tools that create a separate conventions rule file (e.g., cursor, roo)
    if (isSimulated && meta.createsSeparateConventionsRule && meta.additionalConventions) {
      const conventionsContent = this.generateAdditionalConventionsSectionFromMeta(meta);
      const settablePaths = factory.class.getSettablePaths();
      const nonRootPath = "nonRoot" in settablePaths ? settablePaths.nonRoot : null;
      if (nonRootPath) {
        // Use .md extension - CursorRule.fromRulesyncRule will convert to .mdc
        toolRules.push(
          factory.class.fromRulesyncRule({
            baseDir: this.baseDir,
            rulesyncRule: new RulesyncRule({
              baseDir: this.baseDir,
              relativeDirPath: nonRootPath.relativeDirPath,
              relativeFilePath: "additional-conventions.md",
              frontmatter: {
                root: false,
                targets: [this.toolTarget],
              },
              body: conventionsContent,
            }),
            validate: true,
            global: this.global,
          }),
        );
      }
    }

    const rootRuleIndex = toolRules.findIndex((rule) => rule.isRoot());
    if (rootRuleIndex === -1) {
      return toolRules;
    }

    // For tools that don't create a separate conventions rule, prepend to the root rule
    const rootRule = toolRules[rootRuleIndex];
    if (!rootRule) {
      return toolRules;
    }

    // Generate reference section based on meta configuration
    const referenceSection = this.generateReferenceSectionFromMeta(meta, toolRules);

    // Generate additional conventions section (only if not creating a separate rule)
    const conventionsSection =
      !meta.createsSeparateConventionsRule && meta.additionalConventions
        ? this.generateAdditionalConventionsSectionFromMeta(meta)
        : "";

    // Prepend sections to root rule content
    const newContent = referenceSection + conventionsSection + rootRule.getFileContent();
    rootRule.setFileContent(newContent);

    return toolRules;
  }

  private buildSkillList(skillClass: {
    isTargetedByRulesyncSkill: (rulesyncSkill: RulesyncSkill) => boolean;
    getSettablePaths: (options?: { global?: boolean }) => { relativeDirPath: string };
  }): Array<{
    name: string;
    description: string;
    path: string;
  }> {
    if (!this.skills) return [];

    const toolRelativeDirPath = skillClass.getSettablePaths({
      global: this.global,
    }).relativeDirPath;
    return this.skills
      .filter((skill) => skillClass.isTargetedByRulesyncSkill(skill))
      .map((skill) => {
        const frontmatter = skill.getFrontmatter();
        // Use tool-specific relative path, not rulesync's path
        const relativePath = join(toolRelativeDirPath, skill.getDirName(), SKILL_FILE_NAME);
        return {
          name: frontmatter.name,
          description: frontmatter.description,
          path: relativePath,
        };
      });
  }

  /**
   * Generate reference section based on meta configuration.
   */
  private generateReferenceSectionFromMeta(
    meta: ToolRuleFactory["meta"],
    toolRules: ToolRule[],
  ): string {
    switch (meta.ruleDiscoveryMode) {
      case "toon":
        return this.generateToonReferencesSection(toolRules);
      case "claudecode-legacy":
        return this.generateReferencesSection(toolRules);
      case "auto":
      default:
        return "";
    }
  }

  /**
   * Generate additional conventions section based on meta configuration.
   */
  private generateAdditionalConventionsSectionFromMeta(meta: ToolRuleFactory["meta"]): string {
    const { additionalConventions } = meta;
    if (!additionalConventions) {
      return "";
    }

    const conventions: Parameters<typeof this.generateAdditionalConventionsSection>[0] = {};

    if (additionalConventions.commands) {
      const { commandClass } = additionalConventions.commands;
      const relativeDirPath = commandClass.getSettablePaths({
        global: this.global,
      }).relativeDirPath;
      conventions.commands = { relativeDirPath };
    }

    if (additionalConventions.subagents) {
      const { subagentClass } = additionalConventions.subagents;
      const relativeDirPath = subagentClass.getSettablePaths({
        global: this.global,
      }).relativeDirPath;
      conventions.subagents = { relativeDirPath };
    }

    if (additionalConventions.skills) {
      const { skillClass, globalOnly } = additionalConventions.skills;
      // Skip skills if they are globalOnly and we're not in global mode
      if (!globalOnly || this.global) {
        conventions.skills = {
          skillList: this.buildSkillList(skillClass),
        };
      }
    }

    return this.generateAdditionalConventionsSection(conventions);
  }

  async convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]> {
    const toolRules = toolFiles.filter((file): file is ToolRule => file instanceof ToolRule);

    const rulesyncRules = toolRules.map((toolRule) => {
      return toolRule.toRulesyncRule();
    });

    return rulesyncRules;
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Load and parse rulesync rule files from .rulesync/rules/ directory
   */
  async loadRulesyncFiles(): Promise<RulesyncFile[]> {
    const files = await findFilesByGlobs(join(RULESYNC_RULES_RELATIVE_DIR_PATH, "*.md"));
    logger.debug(`Found ${files.length} rulesync files`);
    const rulesyncRules = await Promise.all(
      files.map((file) => RulesyncRule.fromFile({ relativeFilePath: basename(file) })),
    );

    if (this.toolTarget === "opencode") {
      const subagentFiles = await findFilesByGlobs(
        join(this.baseDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "*.md"),
      );
      logger.debug(`Found ${subagentFiles.length} subagent files for OpenCode`);
      const subagentRules = await Promise.all(
        subagentFiles.map(async (file) => {
          const content = await readFileContent(file);
          const { frontmatter, body } = parseFrontmatter(content);
          return new RulesyncRule({
            baseDir: this.baseDir,
            relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
            relativeFilePath: basename(file),
            frontmatter: frontmatter,
            body,
          });
        }),
      );
      rulesyncRules.push(...subagentRules);
    }

    const rootRules = rulesyncRules.filter((rule) => rule.getFrontmatter().root);

    // A root file should be only one
    if (rootRules.length > 1) {
      throw new Error("Multiple root rulesync rules found");
    }

    // If global is true, return only the root rule
    if (this.global) {
      const nonRootRules = rulesyncRules.filter((rule) => !rule.getFrontmatter().root);
      if (nonRootRules.length > 0) {
        logger.warn(
          `${nonRootRules.length} non-root rulesync rules found, but it's in global mode, so ignoring them`,
        );
      }
      return rootRules;
    }

    return rulesyncRules;
  }

  async loadRulesyncFilesLegacy(): Promise<RulesyncFile[]> {
    const legacyFiles = await findFilesByGlobs(join(RULESYNC_RELATIVE_DIR_PATH, "*.md"));
    logger.debug(`Found ${legacyFiles.length} legacy rulesync files`);
    return Promise.all(
      legacyFiles.map((file) => RulesyncRule.fromFileLegacy({ relativeFilePath: basename(file) })),
    );
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
    
    if (Array.isArray(e.capabilities) && !e.capabilities.every((item) => typeof item === "string")) {
      return false;
    }
    if (Array.isArray(e.mcp_servers) && !e.mcp_servers.every((item) => typeof item === "string")) {
      return false;
    }
    if (Array.isArray(e.delegates_to) && !e.delegates_to.every((item) => typeof item === "string")) {
      return false;
    }
    if (Array.isArray(e.accepts_from) && !e.accepts_from.every((item) => typeof item === "string")) {
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
      const agentRules: ToolFile[] = [];

      for (const agentEntry of registry.agents) {
        if (!this.validateRegistryEntry(agentEntry)) {
          logger.warn(
            `Invalid registry entry structure at ${registryPath}: entry missing required fields or has invalid structure. Skipping.`,
          );
          continue;
        }
        
        try {
          const agentRule = await OpenCodeRule.fromAgent({
            baseDir: this.baseDir,
            agentEntry,
            validate: true,
          });
          agentRules.push(agentRule);
        } catch (error) {
          logger.warn(
            `Failed to load agent file ${agentEntry.file}: ${formatError(error)}. Skipping.`,
          );
        }
      }

      logger.debug(`Loaded ${agentRules.length} agent files from registry.json`);
      return agentRules;
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
   * Implementation of abstract method from FeatureProcessor
   * Load tool-specific rule configurations and parse them into ToolRule instances
   */
  async loadToolFiles({
    forDeletion: _forDeletion = false,
  }: {
    forDeletion?: boolean;
  } = {}): Promise<ToolFile[]> {
    try {
      const factory = this.getFactory(this.toolTarget);
      const settablePaths = factory.class.getSettablePaths({ global: this.global });

      if (this.toolTarget === "opencode") {
        const agentRules = await this.loadOpenCodeAgentFiles();
        logger.debug(`Found ${agentRules.length} agent files from registry`);

        const rootToolRules = await (async () => {
          if (!settablePaths.root) {
            return [];
          }

          const rootFilePaths = await findFilesByGlobs(
            join(
              this.baseDir,
              settablePaths.root.relativeDirPath ?? ".",
              settablePaths.root.relativeFilePath,
            ),
          );
          return await Promise.all(
            rootFilePaths.map((filePath) =>
              factory.class.fromFile({
                baseDir: this.baseDir,
                relativeFilePath: basename(filePath),
                global: this.global,
              }),
            ),
          );
        })();
        logger.debug(`Found ${rootToolRules.length} root tool rule files`);

        const nonRootToolRules = await (async () => {
          if (!settablePaths.nonRoot) {
            return [];
          }

          const nonRootFilePaths = await findFilesByGlobs(
            join(
              this.baseDir,
              settablePaths.nonRoot.relativeDirPath,
              `*.${factory.meta.extension}`,
            ),
          );
          return await Promise.all(
            nonRootFilePaths.map((filePath) =>
              factory.class.fromFile({
                baseDir: this.baseDir,
                relativeFilePath: basename(filePath),
                global: this.global,
              }),
            ),
          );
        })();
        logger.debug(`Found ${nonRootToolRules.length} non-root tool rule files`);

        return [...rootToolRules, ...nonRootToolRules, ...agentRules];
      }
      const rootToolRules = await (async () => {
        if (!settablePaths.root) {
          return [];
        }

        const rootFilePaths = await findFilesByGlobs(
          join(
            this.baseDir,
            settablePaths.root.relativeDirPath ?? ".",
            settablePaths.root.relativeFilePath,
          ),
        );
        return await Promise.all(
          rootFilePaths.map((filePath) =>
            factory.class.fromFile({
              baseDir: this.baseDir,
              relativeFilePath: basename(filePath),
              global: this.global,
            }),
          ),
        );
      })();
      logger.debug(`Found ${rootToolRules.length} root tool rule files`);

      const nonRootToolRules = await (async () => {
        if (!settablePaths.nonRoot) {
          return [];
        }

        const nonRootFilePaths = await findFilesByGlobs(
          join(this.baseDir, settablePaths.nonRoot.relativeDirPath, `*.${factory.meta.extension}`),
        );
        return await Promise.all(
          nonRootFilePaths.map((filePath) =>
            factory.class.fromFile({
              baseDir: this.baseDir,
              relativeFilePath: basename(filePath),
              global: this.global,
            }),
          ),
        );
      })();
      logger.debug(`Found ${nonRootToolRules.length} non-root tool rule files`);

      return [...rootToolRules, ...nonRootToolRules];
    } catch (error) {
      logger.error(`Failed to load tool files: ${formatError(error)}`);
      return [];
    }
  }

  /**
   * Implementation of abstract method from FeatureProcessor
   * Return the tool targets that this processor supports
   */
  static getToolTargets({ global = false }: { global?: boolean } = {}): ToolTarget[] {
    if (global) {
      return rulesProcessorToolTargetsGlobal;
    }
    return rulesProcessorToolTargets;
  }

  private generateToonReferencesSection(toolRules: ToolRule[]): string {
    const toolRulesWithoutRoot = toolRules.filter((rule) => !rule.isRoot());

    if (toolRulesWithoutRoot.length === 0) {
      return "";
    }

    const lines: string[] = [];
    lines.push(
      "Please also reference the following rules as needed. The list below is provided in TOON format, and `@` stands for the project root directory.",
    );
    lines.push("");

    const rules = toolRulesWithoutRoot.map((toolRule) => {
      const rulesyncRule = toolRule.toRulesyncRule();
      const frontmatter = rulesyncRule.getFrontmatter();

      const rule: {
        path: string;
        description?: string;
        applyTo?: string[];
      } = {
        path: `@${toolRule.getRelativePathFromCwd()}`,
      };

      if (frontmatter.description) {
        rule.description = frontmatter.description;
      }

      if (frontmatter.globs && frontmatter.globs.length > 0) {
        rule.applyTo = frontmatter.globs;
      }

      return rule;
    });

    const toonContent = encode({
      rules,
    });
    lines.push(toonContent);

    return lines.join("\n") + "\n\n";
  }

  private generateReferencesSection(toolRules: ToolRule[]): string {
    const toolRulesWithoutRoot = toolRules.filter((rule) => !rule.isRoot());

    if (toolRulesWithoutRoot.length === 0) {
      return "";
    }

    const lines: string[] = [];
    lines.push("Please also reference the following rules as needed:");
    lines.push("");

    for (const toolRule of toolRulesWithoutRoot) {
      // Escape double quotes in description
      const escapedDescription = toolRule.getDescription()?.replace(/"/g, '\\"');
      const globsText = toolRule.getGlobs()?.join(",");

      lines.push(
        `@${toolRule.getRelativePathFromCwd()} description: "${escapedDescription}" applyTo: "${globsText}"`,
      );
    }

    return lines.join("\n") + "\n\n";
  }

  private generateAdditionalConventionsSection({
    commands,
    subagents,
    skills,
  }: {
    commands?: {
      relativeDirPath: string;
    };
    subagents?: {
      relativeDirPath: string;
    };
    skills?: {
      skillList?: Array<{
        name: string;
        description: string;
        path: string;
      }>;
    };
  }): string {
    const overview = `# Additional Conventions Beyond the Built-in Functions

As this project's AI coding tool, you must follow the additional conventions below, in addition to the built-in functions.`;

    const commandsSection = commands
      ? `## Simulated Custom Slash Commands

Custom slash commands allow you to define frequently-used prompts as Markdown files that you can execute.

### Syntax

Users can use following syntax to invoke a custom command.

\`\`\`txt
s/<command> [arguments]
\`\`\`

This syntax employs a double slash (\`s/\`) to prevent conflicts with built-in slash commands.
The \`s\` in \`s/\` stands for *simulate*. Because custom slash commands are not built-in, this syntax provides a pseudo way to invoke them.

When users call a custom slash command, you have to look for the markdown file, \`${join(RULESYNC_COMMANDS_RELATIVE_DIR_PATH, "{command}.md")}\`, then execute the contents of that file as the block of operations.`
      : "";

    const subagentsSection = subagents
      ? `## Simulated Subagents

Simulated subagents are specialized AI assistants that can be invoked to handle specific types of tasks. In this case, it can be appear something like custom slash commands simply. Simulated subagents can be called by custom slash commands.

When users call a simulated subagent, it will look for the corresponding markdown file, \`${join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "{subagent}.md")}\`, and execute its contents as the block of operations.

For example, if the user instructs \`Call planner subagent to plan the refactoring\`, you have to look for the markdown file, \`${join(RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "planner.md")}\`, and execute its contents as the block of operations.`
      : "";

    const skillsSection = skills ? this.generateSkillsSection(skills) : "";

    const result =
      [
        overview,
        ...(this.simulateCommands &&
        CommandsProcessor.getToolTargetsSimulated().includes(this.toolTarget)
          ? [commandsSection]
          : []),
        ...(this.simulateSubagents &&
        SubagentsProcessor.getToolTargetsSimulated().includes(this.toolTarget)
          ? [subagentsSection]
          : []),
        ...(this.simulateSkills &&
        SkillsProcessor.getToolTargetsSimulated().includes(this.toolTarget)
          ? [skillsSection]
          : []),
      ].join("\n\n") + "\n\n";
    return result;
  }

  private generateSkillsSection(skills: {
    skillList?: Array<{
      name: string;
      description: string;
      path: string;
    }>;
  }): string {
    if (!skills.skillList || skills.skillList.length === 0) {
      return "";
    }

    const skillListWithAtPrefix = skills.skillList.map((skill) => ({
      ...skill,
      path: `@${skill.path}`,
    }));
    const toonContent = encode({ skillList: skillListWithAtPrefix });

    return `## Simulated Skills

Simulated skills are specialized capabilities that can be invoked to handle specific types of tasks. When you determine that a skill would be helpful for the current task, read the corresponding SKILL.md file and execute its instructions.

${toonContent}`;
  }

  async writeAiFiles(aiFiles: AiFile[]): Promise<number> {
    const writtenCount = await super.writeAiFiles(aiFiles);

    if (this.toolTarget === "opencode") {
      try {
        const agentRules = aiFiles.filter((file): file is OpenCodeRule => {
          if (!(file instanceof OpenCodeRule)) {
            return false;
          }
          const rule = file as any;
          return rule.agentEntry !== undefined;
        });

        if (agentRules.length > 0) {
          const registryManager = new OpenCodeRegistryManager(this.baseDir);
          await registryManager.updateAndWriteRegistry(agentRules);
          logger.debug(`Updated registry.json with ${agentRules.length} agent entries`);
        }
      } catch (error) {
        logger.warn(`Failed to update registry.json: ${formatError(error)}`);
      }
    }

    return writtenCount;
  }
}
