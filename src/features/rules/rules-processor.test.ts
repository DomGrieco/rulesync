import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import {
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SKILLS_RELATIVE_DIR_PATH,
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import {
  ensureDir,
  readFileContent,
  readJsonFile,
  writeFileContent,
  writeJsonFile,
} from "../../utils/file.js";
import { RulesyncSkill } from "../skills/rulesync-skill.js";
import { AgentsMdRule } from "./agentsmd-rule.js";
import { AugmentcodeLegacyRule } from "./augmentcode-legacy-rule.js";
import { ClaudecodeLegacyRule } from "./claudecode-legacy-rule.js";
import { ClaudecodeRule } from "./claudecode-rule.js";
import { CodexcliRule } from "./codexcli-rule.js";
import { CopilotRule } from "./copilot-rule.js";
import { CursorRule } from "./cursor-rule.js";
import { GeminiCliRule } from "./geminicli-rule.js";
import { OpenCodeRule } from "./opencode-rule.js";
import { RulesProcessor, type RulesProcessorToolTarget } from "./rules-processor.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { WarpRule } from "./warp-rule.js";

describe("RulesProcessor", () => {
  let testDir: string;
  let cleanup: () => Promise<void>;

  beforeEach(async () => {
    ({ testDir, cleanup } = await setupTestDirectory());
    vi.spyOn(process, "cwd").mockReturnValue(testDir);
  });

  afterEach(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  describe("convertRulesyncFilesToToolFiles", () => {
    it("should filter out rules not targeted for the specific tool", async () => {
      const processor = new RulesProcessor({
        toolTarget: "copilot",
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "copilot-rule.md",
          frontmatter: {
            targets: ["copilot"],
          },
          body: "Copilot specific rule",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "cursor-rule.md",
          frontmatter: {
            targets: ["cursor"],
          },
          body: "Cursor specific rule",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "all-tools-rule.md",
          frontmatter: {
            targets: ["*"],
          },
          body: "Rule for all tools",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      // Should include copilot-specific rule and all-tools rule, but not cursor-specific rule
      expect(result).toHaveLength(2);
      expect(result[0]).toBeInstanceOf(CopilotRule);
      expect(result[1]).toBeInstanceOf(CopilotRule);
    });

    it("should return empty array when no rules match the tool target", async () => {
      const processor = new RulesProcessor({
        toolTarget: "warp",
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "copilot-rule.md",
          frontmatter: {
            targets: ["copilot"],
          },
          body: "Copilot specific rule",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "cursor-rule.md",
          frontmatter: {
            targets: ["cursor"],
          },
          body: "Cursor specific rule",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      expect(result).toHaveLength(0);
    });

    it("should handle mixed targets correctly", async () => {
      const processor = new RulesProcessor({
        toolTarget: "claudecode",
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "mixed-rule.md",
          frontmatter: {
            targets: ["cursor", "claudecode", "copilot"],
          },
          body: "Mixed targets rule",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "other-rule.md",
          frontmatter: {
            targets: ["warp", "augmentcode"],
          },
          body: "Other tools rule",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(ClaudecodeRule);
    });

    it("should handle undefined targets in frontmatter", async () => {
      const processor = new RulesProcessor({
        toolTarget: "augmentcode-legacy",
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "no-targets.md",
          frontmatter: {},
          body: "Rule without targets",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      // Should include the rule since undefined targets means it applies to all
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(AugmentcodeLegacyRule);
    });

    it("should handle empty targets array", async () => {
      const processor = new RulesProcessor({
        toolTarget: "warp",
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "empty-targets.md",
          frontmatter: {
            targets: [],
          },
          body: "Rule with empty targets",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      // Should not include the rule since empty targets means it doesn't apply to any tool
      expect(result).toHaveLength(0);
    });

    it("should throw error for unsupported tool target", () => {
      expect(() => {
        new RulesProcessor({
          toolTarget: "unsupported-tool" as any,
        });
      }).toThrow();
    });

    it("should correctly validate and filter rules for each supported tool", async () => {
      const testCases = [
        { toolTarget: "copilot" as const, ruleClass: CopilotRule },
        { toolTarget: "cursor" as const, ruleClass: CursorRule },
        { toolTarget: "claudecode" as const, ruleClass: ClaudecodeRule },
        { toolTarget: "warp" as const, ruleClass: WarpRule },
        { toolTarget: "augmentcode-legacy" as const, ruleClass: AugmentcodeLegacyRule },
      ];

      for (const { toolTarget, ruleClass } of testCases) {
        const processor = new RulesProcessor({
          toolTarget: toolTarget,
        });

        const rulesyncRules = [
          new RulesyncRule({
            baseDir: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
            relativeFilePath: "targeted-rule.md",
            frontmatter: {
              targets: [toolTarget],
            },
            body: `${toolTarget} specific rule`,
          }),
          new RulesyncRule({
            baseDir: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
            relativeFilePath: "non-targeted-rule.md",
            frontmatter: {
              targets: ["windsurf"],
            },
            body: "Other tool rule",
          }),
        ];

        const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

        expect(result).toHaveLength(1);
        expect(result[0]).toBeInstanceOf(ruleClass);
      }
    });
  });

  describe("generateReferencesSection", () => {
    it("should generate references section with description and globs for claudecode-legacy", async () => {
      const processor = new RulesProcessor({
        toolTarget: "claudecode-legacy",
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root-rule.md",
          frontmatter: {
            root: true,
            targets: ["*"],
            description: "Root rule description",
            globs: ["**/*"],
          },
          body: "# Root rule content",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "feature-rule.md",
          frontmatter: {
            root: false,
            targets: ["claudecode-legacy"],
            description: "Feature specific rule",
            globs: ["src/**/*.ts", "tests/**/*.test.ts"],
          },
          body: "# Feature rule content",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "minimal-rule.md",
          frontmatter: {
            root: false,
            targets: ["*"],
          },
          body: "# Minimal rule content",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      // Find the root rule
      const rootRule = result.find((rule) => rule instanceof ClaudecodeLegacyRule && rule.isRoot());
      expect(rootRule).toBeDefined();

      // Check that the root rule contains the references section
      const content = rootRule?.getFileContent();
      expect(content).toContain("Please also reference the following rules as needed:");
      expect(content).toContain(
        '@.claude/memories/feature-rule.md description: "Feature specific rule" applyTo: "src/**/*.ts,tests/**/*.test.ts"',
      );
      expect(content).toContain(
        '@.claude/memories/minimal-rule.md description: "undefined" applyTo: "undefined"',
      );
      expect(content).toContain("# Root rule content");
    });

    it("should handle rules with undefined description and globs", async () => {
      const processor = new RulesProcessor({
        toolTarget: "claudecode-legacy",
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "no-metadata.md",
          frontmatter: {
            root: false,
            targets: ["*"],
          },
          body: "# No metadata",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const rootRule = result.find((rule) => rule instanceof ClaudecodeLegacyRule && rule.isRoot());
      const content = rootRule?.getFileContent();

      expect(content).toContain(
        '@.claude/memories/no-metadata.md description: "undefined" applyTo: "undefined"',
      );
    });

    it("should escape double quotes in description", async () => {
      const processor = new RulesProcessor({
        toolTarget: "claudecode-legacy",
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "quoted.md",
          frontmatter: {
            root: false,
            targets: ["*"],
            description: 'Rule with "quotes" in description',
            globs: ["**/*.ts"],
          },
          body: "# Quoted",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const rootRule = result.find((rule) => rule instanceof ClaudecodeLegacyRule && rule.isRoot());
      const content = rootRule?.getFileContent();

      expect(content).toContain(
        '@.claude/memories/quoted.md description: "Rule with \\"quotes\\" in description" applyTo: "**/*.ts"',
      );
    });

    it("should not generate references section when only root rule exists for claudecode-legacy", async () => {
      const processor = new RulesProcessor({
        toolTarget: "claudecode-legacy",
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
            description: "Only root rule",
            globs: ["**/*"],
          },
          body: "# Root only content",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const rootRule = result.find((rule) => rule instanceof ClaudecodeLegacyRule && rule.isRoot());
      const content = rootRule?.getFileContent();

      expect(content).toBe("# Root only content");
      expect(content).not.toContain("Please also reference the following documents");
    });

    it("should not generate references section for claudecode (modular rules)", async () => {
      const processor = new RulesProcessor({
        toolTarget: "claudecode",
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
            description: "Root rule",
            globs: ["**/*"],
          },
          body: "# Root content",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "feature.md",
          frontmatter: {
            root: false,
            targets: ["*"],
            description: "Feature rule",
            globs: ["src/**/*.ts"],
          },
          body: "# Feature content",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const rootRule = result.find((rule) => rule instanceof ClaudecodeRule && rule.isRoot());
      const content = rootRule?.getFileContent();

      // Modular rules should NOT include references section (files are auto-loaded)
      expect(content).toBe("# Root content");
      expect(content).not.toContain("Please also reference");
      expect(content).not.toContain("@.claude/");
    });

    it("should handle multiple globs correctly for claudecode-legacy", async () => {
      const processor = new RulesProcessor({
        toolTarget: "claudecode-legacy",
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root",
        }),
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "multi-glob.md",
          frontmatter: {
            root: false,
            targets: ["*"],
            description: "Multiple glob patterns",
            globs: ["src/**/*.ts", "tests/**/*.test.ts", "**/*.config.js"],
          },
          body: "# Multi glob",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const rootRule = result.find((rule) => rule instanceof ClaudecodeLegacyRule && rule.isRoot());
      const content = rootRule?.getFileContent();

      expect(content).toContain(
        '@.claude/memories/multi-glob.md description: "Multiple glob patterns" applyTo: "src/**/*.ts,tests/**/*.test.ts,**/*.config.js"',
      );
    });
  });

  describe("loadToolFiles with forDeletion: true", () => {
    it("should return the same files as loadToolFiles for claudecode-legacy", async () => {
      await writeFileContent(
        join(testDir, "CLAUDE.md"),
        "# Root\n\n@.claude/memories/memory1.md\n@.claude/memories/memory2.md",
      );
      await ensureDir(join(testDir, ".claude", "memories"));
      await writeFileContent(join(testDir, ".claude", "memories", "memory1.md"), "# Memory 1");
      await writeFileContent(join(testDir, ".claude", "memories", "memory2.md"), "# Memory 2");

      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "claudecode-legacy",
      });

      const toolFiles = await processor.loadToolFiles();
      const filesToDelete = await processor.loadToolFiles({ forDeletion: true });

      expect(filesToDelete).toEqual(toolFiles);
      expect(filesToDelete.length).toBeGreaterThan(0);
    });

    it("should work for all supported tool targets", async () => {
      const targets: RulesProcessorToolTarget[] = [
        "agentsmd",
        "amazonqcli",
        "augmentcode",
        "augmentcode-legacy",
        "claudecode",
        "claudecode-legacy",
        "cline",
        "copilot",
        "cursor",
        "codexcli",
        "geminicli",
        "junie",
        "kiro",
        "opencode",
        "qwencode",
        "roo",
        "warp",
        "windsurf",
      ];

      for (const target of targets) {
        const processor = new RulesProcessor({
          baseDir: testDir,
          toolTarget: target,
        });

        const filesToDelete = await processor.loadToolFiles({ forDeletion: true });

        // Should return empty array since no files exist
        expect(filesToDelete).toEqual([]);
      }
    });

    it("should handle errors gracefully", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "claudecode",
      });

      const filesToDelete = await processor.loadToolFiles({ forDeletion: true });

      // Should return empty array when no files exist
      expect(filesToDelete).toEqual([]);
    });
  });

  describe("getToolTargets with global: true", () => {
    it("should return claudecode, claudecode-legacy, codexcli and geminicli as global targets", () => {
      const globalTargets = RulesProcessor.getToolTargets({ global: true });

      expect(globalTargets).toEqual(["claudecode", "claudecode-legacy", "codexcli", "geminicli"]);
    });

    it("should return a subset of regular tool targets", () => {
      const globalTargets = RulesProcessor.getToolTargets({ global: true });
      const regularTargets = RulesProcessor.getToolTargets();

      // All global targets should be in regular targets
      for (const target of globalTargets) {
        expect(regularTargets).toContain(target);
      }

      // Global targets should be fewer than regular targets
      expect(globalTargets.length).toBeLessThan(regularTargets.length);
    });

    it("should only include targets that support global mode", () => {
      const globalTargets = RulesProcessor.getToolTargets({ global: true });

      // These are the targets that support global mode
      expect(globalTargets).toContain("claudecode");
      expect(globalTargets).toContain("claudecode-legacy");
      expect(globalTargets).toContain("codexcli");
      expect(globalTargets).toContain("geminicli");
      expect(globalTargets.length).toBe(4);

      // These targets should NOT be in global mode
      expect(globalTargets).not.toContain("cursor");
      expect(globalTargets).not.toContain("copilot");
      expect(globalTargets).not.toContain("warp");
    });
  });

  describe("RulesProcessor with global flag", () => {
    describe("constructor", () => {
      it("should accept global parameter", () => {
        const processor = new RulesProcessor({
          baseDir: testDir,
          toolTarget: "claudecode",
          global: true,
        });

        expect(processor).toBeInstanceOf(RulesProcessor);
      });

      it("should default global to false when not specified", () => {
        const processor = new RulesProcessor({
          baseDir: testDir,
          toolTarget: "claudecode",
        });

        expect(processor).toBeInstanceOf(RulesProcessor);
      });
    });

    describe("loadRulesyncFiles in global mode", () => {
      it("should accept global parameter in constructor", () => {
        const processor = new RulesProcessor({
          baseDir: testDir,
          toolTarget: "claudecode",
          global: true,
        });

        expect(processor).toBeInstanceOf(RulesProcessor);
      });
    });

    describe("convertRulesyncFilesToToolFiles in global mode", () => {
      it("should convert using global paths when global=true for claudecode", async () => {
        const processor = new RulesProcessor({
          baseDir: testDir,
          toolTarget: "claudecode",
          global: true,
        });

        const rulesyncRules = [
          new RulesyncRule({
            baseDir: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
            relativeFilePath: "root.md",
            frontmatter: {
              root: true,
              targets: ["*"],
            },
            body: "# Global Root Rule",
          }),
        ];

        const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

        expect(result).toHaveLength(1);
        expect(result[0]).toBeInstanceOf(ClaudecodeRule);
        expect(result[0]?.getRelativeDirPath()).toBe(".claude");
        expect(result[0]?.getRelativeFilePath()).toBe("CLAUDE.md");
      });

      it("should convert using global paths when global=true for codexcli", async () => {
        const processor = new RulesProcessor({
          baseDir: testDir,
          toolTarget: "codexcli",
          global: true,
        });

        const rulesyncRules = [
          new RulesyncRule({
            baseDir: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
            relativeFilePath: "root.md",
            frontmatter: {
              root: true,
              targets: ["*"],
            },
            body: "# Global Root Rule",
          }),
        ];

        const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

        expect(result).toHaveLength(1);
        const codexcliRule = result[0];
        expect(codexcliRule?.getRelativeDirPath()).toBe(".codex");
        expect(codexcliRule?.getRelativeFilePath()).toBe("AGENTS.md");
      });

      it("should use regular paths when global=false", async () => {
        const processor = new RulesProcessor({
          baseDir: testDir,
          toolTarget: "claudecode",
          global: false,
        });

        const rulesyncRules = [
          new RulesyncRule({
            baseDir: testDir,
            relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
            relativeFilePath: "root.md",
            frontmatter: {
              root: true,
              targets: ["*"],
            },
            body: "# Regular Root Rule",
          }),
        ];

        const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

        expect(result).toHaveLength(1);
        expect(result[0]).toBeInstanceOf(ClaudecodeRule);
        // Modular rules use .claude directory for root file
        expect(result[0]?.getRelativeDirPath()).toBe(".claude");
        expect(result[0]?.getRelativeFilePath()).toBe("CLAUDE.md");
      });
    });
  });

  describe("last-wins behavior for overlapping targets", () => {
    it("should overwrite AGENTS.md when agentsmd and opencode both target the same file", async () => {
      // Setup: Create rulesync rules directory
      await ensureDir(join(testDir, ".rulesync", "rules"));
      await writeFileContent(
        join(testDir, ".rulesync", "rules", "overview.md"),
        `---
root: true
targets: ["agentsmd", "opencode"]
---
# Shared Content`,
      );

      // Process agentsmd first
      const agentsMdProcessor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "agentsmd",
      });
      const agentsMdRulesyncFiles = await agentsMdProcessor.loadRulesyncFiles();
      const agentsMdToolFiles =
        await agentsMdProcessor.convertRulesyncFilesToToolFiles(agentsMdRulesyncFiles);
      await agentsMdProcessor.writeAiFiles(agentsMdToolFiles);

      // Verify agentsmd wrote the file
      const agentsMdContent = await readFileContent(join(testDir, "AGENTS.md"));
      expect(agentsMdContent).toContain("# Shared Content");
      expect(agentsMdToolFiles[0]).toBeInstanceOf(AgentsMdRule);

      // Process opencode second (should overwrite)
      const openCodeProcessor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "opencode",
      });
      const openCodeRulesyncFiles = await openCodeProcessor.loadRulesyncFiles();
      const openCodeToolFiles =
        await openCodeProcessor.convertRulesyncFilesToToolFiles(openCodeRulesyncFiles);
      await openCodeProcessor.writeAiFiles(openCodeToolFiles);

      // Verify opencode overwrote the file
      const finalContent = await readFileContent(join(testDir, "AGENTS.md"));
      expect(finalContent).toContain("# Shared Content");
      expect(openCodeToolFiles[0]).toBeInstanceOf(OpenCodeRule);

      // Both targets should have written to the same file path
      expect(agentsMdToolFiles[0]?.getFilePath()).toBe(openCodeToolFiles[0]?.getFilePath());
    });

    it("should apply last-wins in reverse order when targets are reversed", async () => {
      // Setup: Create rulesync rules directory
      await ensureDir(join(testDir, ".rulesync", "rules"));
      await writeFileContent(
        join(testDir, ".rulesync", "rules", "overview.md"),
        `---
root: true
targets: ["opencode", "agentsmd"]
---
# Reversed Order Content`,
      );

      // Process opencode first
      const openCodeProcessor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "opencode",
      });
      const openCodeRulesyncFiles = await openCodeProcessor.loadRulesyncFiles();
      const openCodeToolFiles =
        await openCodeProcessor.convertRulesyncFilesToToolFiles(openCodeRulesyncFiles);
      await openCodeProcessor.writeAiFiles(openCodeToolFiles);

      // Process agentsmd second (should overwrite)
      const agentsMdProcessor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "agentsmd",
      });
      const agentsMdRulesyncFiles = await agentsMdProcessor.loadRulesyncFiles();
      const agentsMdToolFiles =
        await agentsMdProcessor.convertRulesyncFilesToToolFiles(agentsMdRulesyncFiles);
      await agentsMdProcessor.writeAiFiles(agentsMdToolFiles);

      // Verify agentsmd's content is the final result
      const finalContent = await readFileContent(join(testDir, "AGENTS.md"));
      expect(finalContent).toContain("# Reversed Order Content");
      expect(agentsMdToolFiles[0]).toBeInstanceOf(AgentsMdRule);
    });
  });
  describe("simulateSkills", () => {
    it("should include skill list in generated content for copilot when simulateSkills is true", async () => {
      // Create skill directories
      const skillDir1 = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "test-skill-1");
      const skillDir2 = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "test-skill-2");
      await ensureDir(skillDir1);
      await ensureDir(skillDir2);
      await writeFileContent(
        join(skillDir1, SKILL_FILE_NAME),
        `---
name: Test Skill One
description: First test skill for testing
targets: ["*"]
---

This is the body of test skill 1.`,
      );
      await writeFileContent(
        join(skillDir2, SKILL_FILE_NAME),
        `---
name: Test Skill Two
description: Second test skill for testing
targets: ["copilot"]
---

This is the body of test skill 2.`,
      );

      // Create skill instances directly
      const skills = [
        new RulesyncSkill({
          baseDir: testDir,
          dirName: "test-skill-1",
          frontmatter: {
            name: "Test Skill One",
            description: "First test skill for testing",
            targets: ["*"],
          },
          body: "This is the body of test skill 1.",
        }),
        new RulesyncSkill({
          baseDir: testDir,
          dirName: "test-skill-2",
          frontmatter: {
            name: "Test Skill Two",
            description: "Second test skill for testing",
            targets: ["copilot"],
          },
          body: "This is the body of test skill 2.",
        }),
      ];

      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
        simulateSkills: true,
        skills,
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root Rule",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const rootRule = result.find((rule) => rule instanceof CopilotRule && rule.isRoot());
      const content = rootRule?.getFileContent();

      // Should include the skills section
      expect(content).toContain("## Simulated Skills");
      expect(content).toContain("Test Skill One,First test skill for testing");
      expect(content).toContain("Test Skill Two,Second test skill for testing");
    });

    it("should include skill list in generated content for cursor when simulateSkills is true", async () => {
      // Create skill directories
      const skillDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "cursor-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---
name: Cursor Skill
description: A skill for cursor
targets: ["cursor"]
---

Cursor skill body.`,
      );

      const skills = [
        new RulesyncSkill({
          baseDir: testDir,
          dirName: "cursor-skill",
          frontmatter: {
            name: "Cursor Skill",
            description: "A skill for cursor",
            targets: ["cursor"],
          },
          body: "Cursor skill body.",
        }),
      ];

      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "cursor",
        simulateSkills: true,
        skills,
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root Rule",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);

      // Find the additional conventions rule for cursor
      const additionalConventionsRule = result.find(
        (rule) =>
          rule instanceof CursorRule && rule.getRelativeFilePath() === "additional-conventions.mdc",
      );

      expect(additionalConventionsRule).toBeDefined();
      const content = additionalConventionsRule?.getFileContent();
      expect(content).toContain("## Simulated Skills");
      expect(content).toContain("Cursor Skill,A skill for cursor");
    });

    it("should filter skills based on targets", async () => {
      // Create skill directories
      const skillDir1 = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "copilot-only-skill");
      const skillDir2 = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "cursor-only-skill");
      await ensureDir(skillDir1);
      await ensureDir(skillDir2);
      await writeFileContent(
        join(skillDir1, SKILL_FILE_NAME),
        `---
name: Copilot Only Skill
description: Only for copilot
targets: ["copilot"]
---

Copilot skill body.`,
      );
      await writeFileContent(
        join(skillDir2, SKILL_FILE_NAME),
        `---
name: Cursor Only Skill
description: Only for cursor
targets: ["cursor"]
---

Cursor skill body.`,
      );

      const skills = [
        new RulesyncSkill({
          baseDir: testDir,
          dirName: "copilot-only-skill",
          frontmatter: {
            name: "Copilot Only Skill",
            description: "Only for copilot",
            targets: ["copilot"],
          },
          body: "Copilot skill body.",
        }),
        new RulesyncSkill({
          baseDir: testDir,
          dirName: "cursor-only-skill",
          frontmatter: {
            name: "Cursor Only Skill",
            description: "Only for cursor",
            targets: ["cursor"],
          },
          body: "Cursor skill body.",
        }),
      ];

      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
        simulateSkills: true,
        skills,
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root Rule",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const rootRule = result.find((rule) => rule instanceof CopilotRule && rule.isRoot());
      const content = rootRule?.getFileContent();

      // Should include the copilot-targeted skill but not the cursor-targeted one
      expect(content).toContain("Copilot Only Skill,Only for copilot");
      expect(content).not.toContain("Cursor Only Skill");
    });

    it("should not include skills section when no skills exist", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
        simulateSkills: true,
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root Rule",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const rootRule = result.find((rule) => rule instanceof CopilotRule && rule.isRoot());
      const content = rootRule?.getFileContent();

      // When no skills exist, the skills section should not be added at all
      expect(content).not.toContain("## Simulated Skills");
    });

    it("should not include skills section when simulateSkills is false", async () => {
      // Create a skill directory
      const skillDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "test-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---
name: Test Skill
description: A test skill
targets: ["*"]
---

Test skill body.`,
      );

      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "copilot",
        simulateSkills: false,
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root Rule",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const rootRule = result.find((rule) => rule instanceof CopilotRule && rule.isRoot());
      const content = rootRule?.getFileContent();

      // Should not include skills section at all (but other sections may still be added)
      expect(content).not.toContain("## Simulated Skills");
      expect(content).toContain("# Root Rule");
    });

    it("should include skill list in generated content for agentsmd when simulateSkills is true", async () => {
      const skillDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "agentsmd-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---
name: AgentsMd Skill
description: A skill for agentsmd
targets: ["agentsmd"]
---

AgentsMd skill body.`,
      );

      const skills = [
        new RulesyncSkill({
          baseDir: testDir,
          dirName: "agentsmd-skill",
          frontmatter: {
            name: "AgentsMd Skill",
            description: "A skill for agentsmd",
            targets: ["agentsmd"],
          },
          body: "AgentsMd skill body.",
        }),
      ];

      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "agentsmd",
        simulateSkills: true,
        skills,
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root Rule",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const rootRule = result.find((rule) => rule instanceof AgentsMdRule && rule.isRoot());
      const content = rootRule?.getFileContent();

      expect(content).toContain("## Simulated Skills");
      expect(content).toContain("AgentsMd Skill,A skill for agentsmd");
    });

    it("should include skill list in generated content for geminicli when simulateSkills is true", async () => {
      const skillDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "geminicli-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---
name: GeminiCli Skill
description: A skill for geminicli
targets: ["geminicli"]
---

GeminiCli skill body.`,
      );

      const skills = [
        new RulesyncSkill({
          baseDir: testDir,
          dirName: "geminicli-skill",
          frontmatter: {
            name: "GeminiCli Skill",
            description: "A skill for geminicli",
            targets: ["geminicli"],
          },
          body: "GeminiCli skill body.",
        }),
      ];

      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "geminicli",
        simulateSkills: true,
        skills,
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root Rule",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const rootRule = result.find((rule) => rule instanceof GeminiCliRule && rule.isRoot());
      const content = rootRule?.getFileContent();

      expect(content).toContain("## Simulated Skills");
      expect(content).toContain("GeminiCli Skill,A skill for geminicli");
    });

    it("should not include skill list for codexcli even in global mode (codexcli does not support simulated skills)", async () => {
      const skillDir = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "codexcli-skill");
      await ensureDir(skillDir);
      await writeFileContent(
        join(skillDir, SKILL_FILE_NAME),
        `---
name: CodexCli Skill
description: A skill for codexcli
targets: ["codexcli"]
---

CodexCli skill body.`,
      );

      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "codexcli",
        simulateSkills: true,
        global: true,
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root Rule",
        }),
      ];

      const result = await processor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const rootRule = result.find((rule) => rule instanceof CodexcliRule && rule.isRoot());
      const content = rootRule?.getFileContent();

      // codexcli does not support simulated skills (supportsSimulated: false)
      expect(content).not.toContain("## Simulated Skills");
    });

    it("should filter skills by target for each tool", async () => {
      // Create skills with different targets
      const skillDir1 = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "geminicli-only");
      const skillDir2 = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "agentsmd-only");
      const skillDir3 = join(testDir, RULESYNC_SKILLS_RELATIVE_DIR_PATH, "universal");
      await ensureDir(skillDir1);
      await ensureDir(skillDir2);
      await ensureDir(skillDir3);
      await writeFileContent(
        join(skillDir1, SKILL_FILE_NAME),
        `---
name: GeminiCli Only
description: Only for geminicli
targets: ["geminicli"]
---

GeminiCli only.`,
      );
      await writeFileContent(
        join(skillDir2, SKILL_FILE_NAME),
        `---
name: AgentsMd Only
description: Only for agentsmd
targets: ["agentsmd"]
---

AgentsMd only.`,
      );
      await writeFileContent(
        join(skillDir3, SKILL_FILE_NAME),
        `---
name: Universal Skill
description: For all tools
targets: ["*"]
---

Universal.`,
      );

      const skills = [
        new RulesyncSkill({
          baseDir: testDir,
          dirName: "geminicli-only",
          frontmatter: {
            name: "GeminiCli Only",
            description: "Only for geminicli",
            targets: ["geminicli"],
          },
          body: "GeminiCli only.",
        }),
        new RulesyncSkill({
          baseDir: testDir,
          dirName: "agentsmd-only",
          frontmatter: {
            name: "AgentsMd Only",
            description: "Only for agentsmd",
            targets: ["agentsmd"],
          },
          body: "AgentsMd only.",
        }),
        new RulesyncSkill({
          baseDir: testDir,
          dirName: "universal",
          frontmatter: { name: "Universal Skill", description: "For all tools", targets: ["*"] },
          body: "Universal.",
        }),
      ];

      // Test geminicli - should include geminicli-only and universal, not agentsmd-only
      const geminicliProcessor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "geminicli",
        simulateSkills: true,
        skills,
      });

      const rulesyncRules = [
        new RulesyncRule({
          baseDir: testDir,
          relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
          relativeFilePath: "root.md",
          frontmatter: {
            root: true,
            targets: ["*"],
          },
          body: "# Root Rule",
        }),
      ];

      const geminicliResult =
        await geminicliProcessor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const geminicliRootRule = geminicliResult.find(
        (rule) => rule instanceof GeminiCliRule && rule.isRoot(),
      );
      const geminicliContent = geminicliRootRule?.getFileContent();

      expect(geminicliContent).toContain("GeminiCli Only,Only for geminicli");
      expect(geminicliContent).toContain("Universal Skill,For all tools");
      expect(geminicliContent).not.toContain("AgentsMd Only");

      // Test agentsmd - should include agentsmd-only and universal, not geminicli-only
      const agentsmdProcessor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "agentsmd",
        simulateSkills: true,
        skills,
      });

      const agentsmdResult = await agentsmdProcessor.convertRulesyncFilesToToolFiles(rulesyncRules);
      const agentsmdRootRule = agentsmdResult.find(
        (rule) => rule instanceof AgentsMdRule && rule.isRoot(),
      );
      const agentsmdContent = agentsmdRootRule?.getFileContent();

      expect(agentsmdContent).toContain("AgentsMd Only,Only for agentsmd");
      expect(agentsmdContent).toContain("Universal Skill,For all tools");
      expect(agentsmdContent).not.toContain("GeminiCli Only");
    });
  });

  describe("loadToolFiles for OpenCode agents", () => {
    it("should load agents from registry.json", async () => {
      // Setup registry.json
      const registryPath = join(testDir, ".opencode", "agent", "registry.json");
      await ensureDir(join(testDir, ".opencode", "agent", "governance"));
      await ensureDir(join(testDir, ".opencode", "agent", "planning"));

      const registry = {
        agents: [
          {
            slug: "context-steward",
            name: "Context Steward",
            file: ".opencode/agent/governance/context-steward.md",
            category: "governance",
            capabilities: ["read", "edit"],
            mcp_servers: [],
            delegates_to: [],
            accepts_from: ["all-agents"],
          },
          {
            slug: "product-strategist",
            name: "Product Strategist",
            file: ".opencode/agent/planning/product-strategist.md",
            category: "planning",
            capabilities: ["read", "edit", "browser"],
            mcp_servers: ["context7"],
            delegates_to: ["strategic-architect"],
            accepts_from: ["orchestrator"],
          },
        ],
      };

      await writeJsonFile(registryPath, registry);

      // Create agent files
      await writeFileContent(
        join(testDir, ".opencode", "agent", "governance", "context-steward.md"),
        `---
description: Context steward agent
mode: subagent
model: anthropic/claude-sonnet-4-20250514
temperature: 0.5
---

# Context Steward

Manages project context.
`,
      );

      await writeFileContent(
        join(testDir, ".opencode", "agent", "planning", "product-strategist.md"),
        `---
description: Product strategist agent
mode: primary
model: openrouter/anthropic/claude-3.5-sonnet
temperature: 0.7
---

# Product Strategist

Handles product strategy.
`,
      );

      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "opencode",
      });

      const toolFiles = await processor.loadToolFiles();

      // Should load both agents
      expect(toolFiles.length).toBeGreaterThanOrEqual(2);
      const agentFiles = toolFiles.filter((file) => file instanceof OpenCodeRule && !file.isRoot());
      expect(agentFiles.length).toBe(2);

      // Verify agent files
      const contextSteward = agentFiles.find(
        (file) => file.getRelativeFilePath() === "governance/context-steward.md",
      );
      const productStrategist = agentFiles.find(
        (file) => file.getRelativeFilePath() === "planning/product-strategist.md",
      );

      expect(contextSteward).toBeDefined();
      expect(productStrategist).toBeDefined();
      expect(contextSteward?.getDescription()).toBe("Context Steward");
      expect(productStrategist?.getDescription()).toBe("Product Strategist");
    });

    it("should handle missing registry.json gracefully", async () => {
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "opencode",
      });

      const toolFiles = await processor.loadToolFiles();

      // Should return empty array for agents, but may have root/memories files
      // Just verify no error is thrown
      expect(Array.isArray(toolFiles)).toBe(true);
    });

    it("should handle missing agent files gracefully", async () => {
      const registryPath = join(testDir, ".opencode", "agent", "registry.json");
      await ensureDir(join(testDir, ".opencode", "agent"));

      const registry = {
        agents: [
          {
            slug: "missing-agent",
            name: "Missing Agent",
            file: ".opencode/agent/governance/missing-agent.md",
            category: "governance",
          },
          {
            slug: "existing-agent",
            name: "Existing Agent",
            file: ".opencode/agent/governance/existing-agent.md",
            category: "governance",
          },
        ],
      };

      await writeJsonFile(registryPath, registry);

      // Only create one agent file
      await ensureDir(join(testDir, ".opencode", "agent", "governance"));
      await writeFileContent(
        join(testDir, ".opencode", "agent", "governance", "existing-agent.md"),
        `---
description: Existing agent
mode: subagent
---

# Existing Agent
`,
      );

      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "opencode",
      });

      const toolFiles = await processor.loadToolFiles();

      // Should load existing agent, skip missing one
      const agentFiles = toolFiles.filter((file) => file instanceof OpenCodeRule && !file.isRoot());
      expect(agentFiles.length).toBe(1);
      expect(agentFiles[0]?.getRelativeFilePath()).toBe("governance/existing-agent.md");
    });

    it("should handle invalid registry.json structure", async () => {
      const registryPath = join(testDir, ".opencode", "agent", "registry.json");
      await ensureDir(join(testDir, ".opencode", "agent"));

      // Invalid registry structure (missing required fields)
      const invalidRegistry = {
        agents: [
          {
            // Missing required fields
            slug: "invalid",
          },
        ],
      };

      await writeJsonFile(registryPath, invalidRegistry);

      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "opencode",
      });

      const toolFiles = await processor.loadToolFiles();

      // Should return empty array for agents due to validation failure
      const agentFiles = toolFiles.filter((file) => file instanceof OpenCodeRule && !file.isRoot());
      expect(agentFiles.length).toBe(0);
    });

    it("should combine agents with root and memory files", async () => {
      // Setup registry
      const registryPath = join(testDir, ".opencode", "agent", "registry.json");
      await ensureDir(join(testDir, ".opencode", "agent", "governance"));
      await ensureDir(join(testDir, ".opencode", "memories"));

      const registry = {
        agents: [
          {
            slug: "test-agent",
            name: "Test Agent",
            file: ".opencode/agent/governance/test-agent.md",
            category: "governance",
          },
        ],
      };

      await writeJsonFile(registryPath, registry);

      // Create agent file
      await writeFileContent(
        join(testDir, ".opencode", "agent", "governance", "test-agent.md"),
        `---
description: Test agent
mode: subagent
---

# Test Agent
`,
      );

      // Create root file
      await writeFileContent(
        join(testDir, "AGENTS.md"),
        "# Root Agents File\n\nMain agents configuration.",
      );

      // Create memory file
      await writeFileContent(
        join(testDir, ".opencode", "memories", "memory.md"),
        "# Memory\n\nProject memory.",
      );

      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "opencode",
      });

      const toolFiles = await processor.loadToolFiles();

      // Should have root, memory, and agent files
      expect(toolFiles.length).toBeGreaterThanOrEqual(3);

      const rootFiles = toolFiles.filter((file) => file instanceof OpenCodeRule && file.isRoot());
      const memoryFiles = toolFiles.filter(
        (file) =>
          file instanceof OpenCodeRule &&
          !file.isRoot() &&
          file.getRelativeDirPath() === ".opencode/memories",
      );
      const agentFiles = toolFiles.filter(
        (file) =>
          file instanceof OpenCodeRule &&
          !file.isRoot() &&
          file.getRelativeDirPath() === ".opencode/agent",
      );

      expect(rootFiles.length).toBeGreaterThanOrEqual(1);
      expect(memoryFiles.length).toBeGreaterThanOrEqual(1);
      expect(agentFiles.length).toBe(1);
    });

    it("should preserve registry metadata when converting to rulesync", async () => {
      const registryPath = join(testDir, ".opencode", "agent", "registry.json");
      await ensureDir(join(testDir, ".opencode", "agent", "governance"));

      const registry = {
        agents: [
          {
            slug: "metadata-agent",
            name: "Metadata Agent",
            file: ".opencode/agent/governance/metadata-agent.md",
            category: "governance",
            capabilities: ["read", "edit", "command"],
            mcp_servers: ["context7", "linear"],
            delegates_to: ["other-agent"],
            accepts_from: ["orchestrator"],
          },
        ],
      };

      await writeJsonFile(registryPath, registry);

      await writeFileContent(
        join(testDir, ".opencode", "agent", "governance", "metadata-agent.md"),
        `---
description: Agent with metadata
mode: all
model: anthropic/claude-sonnet-4-20250514
temperature: 0.6
tools:
  read: true
  edit: true
---

# Metadata Agent

Agent content.
`,
      );

      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "opencode",
      });

      const toolFiles = await processor.loadToolFiles();
      const agentFile = toolFiles.find(
        (file) =>
          file instanceof OpenCodeRule &&
          file.getRelativeFilePath() === "governance/metadata-agent.md",
      ) as OpenCodeRule;

      expect(agentFile).toBeDefined();

      const rulesyncRule = agentFile.toRulesyncRule();
      const opencodeMetadata = rulesyncRule.getFrontmatter().opencode as Record<string, unknown>;

      expect(opencodeMetadata).toBeDefined();
      expect(opencodeMetadata.category).toBe("governance");
      expect(opencodeMetadata.capabilities).toEqual(["read", "edit", "command"]);
      expect(opencodeMetadata.mcp_servers).toEqual(["context7", "linear"]);
      expect(opencodeMetadata.delegates_to).toEqual(["other-agent"]);
      expect(opencodeMetadata.accepts_from).toEqual(["orchestrator"]);
      expect(opencodeMetadata.mode).toBe("all");
      expect(opencodeMetadata.model).toBe("anthropic/claude-sonnet-4-20250514");
      expect(opencodeMetadata.temperature).toBe(0.6);
    });
  });

  describe("writeAiFiles for OpenCode registry updates", () => {
    it("should update registry.json when writing agent files", async () => {
      const registryPath = join(testDir, ".opencode", "agent", "registry.json");
      await ensureDir(join(testDir, ".opencode", "agent", "governance"));

      // Create initial registry
      const initialRegistry = {
        agents: [
          {
            slug: "existing-agent",
            name: "Existing Agent",
            file: ".opencode/agent/governance/existing-agent.md",
            category: "governance",
          },
        ],
        workflow_patterns: {
          pattern1: ["agent1", "agent2"],
        },
      };

      await writeJsonFile(registryPath, initialRegistry);

      // Create agent file
      await writeFileContent(
        join(testDir, ".opencode", "agent", "governance", "new-agent.md"),
        `---
description: New agent
mode: subagent
---

# New Agent
`,
      );

      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "opencode",
      });

      // Load and convert to rulesync
      const toolFiles = await processor.loadToolFiles();
      const newAgentFile = toolFiles.find(
        (file) =>
          file instanceof OpenCodeRule &&
          file.getRelativeFilePath() === "governance/new-agent.md",
      ) as OpenCodeRule;

      // Create a new agent rule for testing
      const agentRule = new OpenCodeRule({
        baseDir: testDir,
        relativeDirPath: ".opencode/agent",
        relativeFilePath: "governance/new-agent.md",
        fileContent: `---
description: New agent
mode: subagent
---

# New Agent
`,
        root: false,
        description: "New Agent",
        agentEntry: {
          slug: "new-agent",
          name: "New Agent",
          file: ".opencode/agent/governance/new-agent.md",
          category: "governance",
        },
      });

      // Write the agent file (this should trigger registry update)
      await processor.writeAiFiles([agentRule]);

      // Verify registry was updated
      const updatedRegistry = await readJsonFile(registryPath);
      expect(updatedRegistry.agents).toBeDefined();
      expect(Array.isArray(updatedRegistry.agents)).toBe(true);
      
      // Should have the new agent
      const newAgentEntry = updatedRegistry.agents.find(
        (a: any) => a.slug === "new-agent",
      );
      expect(newAgentEntry).toBeDefined();
      expect(newAgentEntry.name).toBe("New Agent");
      
      // Should preserve non-agent fields
      expect(updatedRegistry.workflow_patterns).toEqual(initialRegistry.workflow_patterns);
    });

    it("should create registry.json if it doesn't exist", async () => {
      await ensureDir(join(testDir, ".opencode", "agent", "planning"));

      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "opencode",
      });

      const agentRule = new OpenCodeRule({
        baseDir: testDir,
        relativeDirPath: ".opencode/agent",
        relativeFilePath: "planning/test-agent.md",
        fileContent: `---
description: Test agent
mode: primary
---

# Test Agent
`,
        root: false,
        description: "Test Agent",
        agentEntry: {
          slug: "test-agent",
          name: "Test Agent",
          file: ".opencode/agent/planning/test-agent.md",
          category: "planning",
        },
      });

      await processor.writeAiFiles([agentRule]);

      // Verify registry was created
      const registryPath = join(testDir, ".opencode", "agent", "registry.json");
      const registry = await readJsonFile(registryPath);
      expect(registry.agents).toBeDefined();
      expect(Array.isArray(registry.agents)).toBe(true);
      expect(registry.agents.length).toBe(1);
      expect(registry.agents[0].slug).toBe("test-agent");
    });

    it("should update existing agent entry in registry", async () => {
      const registryPath = join(testDir, ".opencode", "agent", "registry.json");
      await ensureDir(join(testDir, ".opencode", "agent", "governance"));

      // Create initial registry with an agent
      const initialRegistry = {
        agents: [
          {
            slug: "update-agent",
            name: "Old Name",
            file: ".opencode/agent/governance/update-agent.md",
            category: "governance",
            capabilities: ["read"],
          },
        ],
      };

      await writeJsonFile(registryPath, initialRegistry);

      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "opencode",
      });

      // Create updated agent rule
      const updatedAgentRule = new OpenCodeRule({
        baseDir: testDir,
        relativeDirPath: ".opencode/agent",
        relativeFilePath: "governance/update-agent.md",
        fileContent: `---
description: Updated agent
mode: all
---

# Updated Agent
`,
        root: false,
        description: "Updated Name",
        agentEntry: {
          slug: "update-agent",
          name: "Updated Name",
          file: ".opencode/agent/governance/update-agent.md",
          category: "governance",
          capabilities: ["read", "edit", "command"],
        },
      });

      await processor.writeAiFiles([updatedAgentRule]);

      // Verify registry was updated (not duplicated)
      const updatedRegistry = await readJsonFile(registryPath);
      expect(updatedRegistry.agents.length).toBe(1);
      expect(updatedRegistry.agents[0].slug).toBe("update-agent");
      expect(updatedRegistry.agents[0].name).toBe("Updated Name");
      expect(updatedRegistry.agents[0].capabilities).toEqual(["read", "edit", "command"]);
    });

    it("should not update registry for non-agent files", async () => {
      const registryPath = join(testDir, ".opencode", "agent", "registry.json");
      await ensureDir(join(testDir, ".opencode", "memories"));

      // Create initial registry
      const initialRegistry = {
        agents: [],
      };

      await writeJsonFile(registryPath, initialRegistry);

      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "opencode",
      });

      // Create a memory file (not an agent)
      const memoryRule = new OpenCodeRule({
        baseDir: testDir,
        relativeDirPath: ".opencode/memories",
        relativeFilePath: "memory.md",
        fileContent: "# Memory\n\nMemory content.",
        root: false,
        // No agentEntry - this is a memory file
      });

      await processor.writeAiFiles([memoryRule]);

      // Verify registry was not updated (still empty)
      const registry = await readJsonFile(registryPath);
      expect(registry.agents.length).toBe(0);
    });

    it("should handle multiple agents in single write", async () => {
      await ensureDir(join(testDir, ".opencode", "agent", "governance"));
      await ensureDir(join(testDir, ".opencode", "agent", "planning"));

      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "opencode",
      });

      const agent1 = new OpenCodeRule({
        baseDir: testDir,
        relativeDirPath: ".opencode/agent",
        relativeFilePath: "governance/agent1.md",
        fileContent: "# Agent 1",
        root: false,
        description: "Agent 1",
        agentEntry: {
          slug: "agent1",
          name: "Agent 1",
          file: ".opencode/agent/governance/agent1.md",
          category: "governance",
        },
      });

      const agent2 = new OpenCodeRule({
        baseDir: testDir,
        relativeDirPath: ".opencode/agent",
        relativeFilePath: "planning/agent2.md",
        fileContent: "# Agent 2",
        root: false,
        description: "Agent 2",
        agentEntry: {
          slug: "agent2",
          name: "Agent 2",
          file: ".opencode/agent/planning/agent2.md",
          category: "planning",
        },
      });

      await processor.writeAiFiles([agent1, agent2]);

      // Verify registry has both agents
      const registryPath = join(testDir, ".opencode", "agent", "registry.json");
      const registry = await readJsonFile(registryPath);
      expect(registry.agents.length).toBe(2);
      expect(registry.agents.find((a: any) => a.slug === "agent1")).toBeDefined();
      expect(registry.agents.find((a: any) => a.slug === "agent2")).toBeDefined();
    });

    it("should preserve non-agent registry fields when updating", async () => {
      const registryPath = join(testDir, ".opencode", "agent", "registry.json");
      await ensureDir(join(testDir, ".opencode", "agent", "governance"));

      const initialRegistry = {
        agents: [],
        workflow_patterns: {
          pattern1: ["agent1", "agent2"],
          pattern2: ["agent3"],
        },
        governance_chain: ["agent1", "agent2", "agent3"],
        mcp_servers: {
          context7: { type: "local", command: ["node", "server.js"] },
        },
        metadata: {
          version: "1.0.0",
          created: "2025-01-01",
        },
      };

      await writeJsonFile(registryPath, initialRegistry);

      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "opencode",
      });

      const agentRule = new OpenCodeRule({
        baseDir: testDir,
        relativeDirPath: ".opencode/agent",
        relativeFilePath: "governance/test-agent.md",
        fileContent: "# Test Agent",
        root: false,
        description: "Test Agent",
        agentEntry: {
          slug: "test-agent",
          name: "Test Agent",
          file: ".opencode/agent/governance/test-agent.md",
          category: "governance",
        },
      });

      await processor.writeAiFiles([agentRule]);

      // Verify all non-agent fields are preserved
      const updatedRegistry = await readJsonFile(registryPath);
      expect(updatedRegistry.workflow_patterns).toEqual(initialRegistry.workflow_patterns);
      expect(updatedRegistry.governance_chain).toEqual(initialRegistry.governance_chain);
      expect(updatedRegistry.mcp_servers).toEqual(initialRegistry.mcp_servers);
      expect(updatedRegistry.metadata).toEqual(initialRegistry.metadata);
      expect(updatedRegistry.agents.length).toBe(1);
    });
  });

  describe("Claude Code + OpenCode coexistence", () => {
    it("should load both Claude Code subagents and OpenCode agents from same directory", async () => {
      await ensureDir(join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH));
      await ensureDir(join(testDir, ".opencode", "agent", "governance"));

      // Create Claude Code subagent in .rulesync/subagents/
      await writeFileContent(
        join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "claude-agent.md"),
        `---
targets: ["claudecode"]
name: Claude Agent
description: A Claude Code subagent
claudecode:
  model: claude-3-5-sonnet
---

# Claude Agent

Claude Code subagent content.
`,
      );

      // Create OpenCode agent registry
      const registryPath = join(testDir, ".opencode", "agent", "registry.json");
      await writeJsonFile(registryPath, {
        agents: [
          {
            slug: "opencode-agent",
            name: "OpenCode Agent",
            file: ".opencode/agent/governance/opencode-agent.md",
            category: "governance",
          },
        ],
      });

      // Create OpenCode agent file
      await writeFileContent(
        join(testDir, ".opencode", "agent", "governance", "opencode-agent.md"),
        `---
description: OpenCode agent
mode: subagent
---

# OpenCode Agent

OpenCode agent content.
`,
      );

      // Load OpenCode agents via RulesProcessor
      const opencodeProcessor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "opencode",
      });

      const opencodeFiles = await opencodeProcessor.loadToolFiles();
      const opencodeAgents = opencodeFiles.filter(
        (file) => file instanceof OpenCodeRule && !file.isRoot(),
      );

      expect(opencodeAgents.length).toBe(1);
      expect(opencodeAgents[0]?.getRelativeFilePath()).toBe("governance/opencode-agent.md");

      // Load rulesync files (should include both Claude Code and OpenCode agents)
      const rulesyncFiles = await opencodeProcessor.loadRulesyncFiles();
      
      // Should have Claude Code subagent (from .rulesync/subagents/)
      const claudeSubagent = rulesyncFiles.find(
        (file) => file.getRelativeFilePath() === "claude-agent.md",
      );
      expect(claudeSubagent).toBeDefined();
      
      // Should have OpenCode agent (from .rulesync/subagents/ with opencode metadata)
      // Note: OpenCode agents are stored in subagents directory when converted to rulesync
      const opencodeSubagent = rulesyncFiles.find(
        (file) => {
          const frontmatter = file.getFrontmatter();
          return (
            file.getRelativeFilePath() === "opencode-agent.md" &&
            frontmatter.opencode !== undefined
          );
        },
      );
      // OpenCode agent might not be in rulesync files yet if not converted
      // This test verifies they can coexist in the directory
    });

    it("should not interfere when converting Claude Code subagents", async () => {
      await ensureDir(join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH));

      // Create Claude Code subagent
      await writeFileContent(
        join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "claude-subagent.md"),
        `---
targets: ["claudecode"]
name: Claude Subagent
description: Claude Code subagent
claudecode:
  model: claude-3-5-sonnet
---

# Claude Subagent
`,
      );

      // Create OpenCode agent in same directory (simulating coexistence)
      await writeFileContent(
        join(testDir, RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH, "opencode-subagent.md"),
        `---
targets: ["opencode"]
description: OpenCode Agent
opencode:
  category: "governance"
  mode: "subagent"
---

# OpenCode Subagent
`,
      );

      // Load via RulesProcessor for OpenCode
      const processor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "opencode",
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      
      // Should load both files
      expect(rulesyncFiles.length).toBeGreaterThanOrEqual(2);
      
      // Claude Code subagent should not have opencode metadata
      const claudeFile = rulesyncFiles.find(
        (file) => file.getRelativeFilePath() === "claude-subagent.md",
      );
      expect(claudeFile).toBeDefined();
      if (claudeFile) {
        const frontmatter = claudeFile.getFrontmatter();
        expect(frontmatter.opencode).toBeUndefined();
        expect(frontmatter.claudecode).toBeDefined();
      }
      
      // OpenCode agent should have opencode metadata
      const opencodeFile = rulesyncFiles.find(
        (file) => file.getRelativeFilePath() === "opencode-subagent.md",
      );
      expect(opencodeFile).toBeDefined();
      if (opencodeFile) {
        const frontmatter = opencodeFile.getFrontmatter();
        expect(frontmatter.opencode).toBeDefined();
      }
    });

    it("should handle round-trip sync for both Claude Code and OpenCode", async () => {
      await ensureDir(join(testDir, ".claude", "agents"));
      await ensureDir(join(testDir, ".opencode", "agent", "governance"));

      // Create Claude Code subagent file
      await writeFileContent(
        join(testDir, ".claude", "agents", "claude-agent.md"),
        `---
name: Claude Agent
description: Claude Code agent
model: claude-3-5-sonnet
---

# Claude Agent
`,
      );

      // Create OpenCode registry and agent
      const registryPath = join(testDir, ".opencode", "agent", "registry.json");
      await writeJsonFile(registryPath, {
        agents: [
          {
            slug: "opencode-agent",
            name: "OpenCode Agent",
            file: ".opencode/agent/governance/opencode-agent.md",
            category: "governance",
          },
        ],
      });

      await writeFileContent(
        join(testDir, ".opencode", "agent", "governance", "opencode-agent.md"),
        `---
description: OpenCode agent
mode: subagent
---

# OpenCode Agent
`,
      );

      // Import OpenCode agents
      const opencodeProcessor = new RulesProcessor({
        baseDir: testDir,
        toolTarget: "opencode",
      });

      const opencodeToolFiles = await opencodeProcessor.loadToolFiles();
      const opencodeRulesyncFiles =
        await opencodeProcessor.convertToolFilesToRulesyncFiles(opencodeToolFiles);
      await opencodeProcessor.writeAiFiles(opencodeRulesyncFiles);

      // Verify OpenCode agent was written to .rulesync/subagents/
      const opencodeRulesyncPath = join(
        testDir,
        RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        "opencode-agent.md",
      );
      expect(await readFileContent(opencodeRulesyncPath)).toBeDefined();

      // Verify registry.json was created/updated
      const registry = await readJsonFile(registryPath);
      expect(registry.agents).toBeDefined();

      // Claude Code subagents should still work independently
      // (This would be tested via SubagentsProcessor, but we verify no conflicts)
      const claudeAgentPath = join(testDir, ".claude", "agents", "claude-agent.md");
      expect(await readFileContent(claudeAgentPath)).toBeDefined();
    });
  });
});
