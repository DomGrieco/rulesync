import { join } from "node:path";
import { RULESYNC_RULES_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { type AiFileFromFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  type ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  ToolRuleSettablePaths,
} from "./tool-rule.js";

export type OpenCodeRuleParams = ToolRuleParams;

export type OpenCodeRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
};

export class OpenCodeRule extends ToolRule {

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

  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): OpenCodeRule {
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
    const frontmatter: Record<string, unknown> = {
      root: this.isRoot(),
      targets: ["opencode"],
      description: this.description ?? "",
    };

    if (this.isRoot()) {
      return new RulesyncRule({
        baseDir: this.baseDir,
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: OpenCodeRule.getSettablePaths().root.relativeFilePath,
        frontmatter,
        body: this.getFileContent(),
      });
    }

    return new RulesyncRule({
      baseDir: this.baseDir,
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter,
      body: this.getFileContent(),
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
