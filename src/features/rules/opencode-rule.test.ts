import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
  RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { OpenCodeRule } from "./opencode-rule.js";
import type { OpenCodeAgentRegistryEntry } from "./opencode-agent-registry.js";
import { RulesyncRule } from "./rulesync-rule.js";

describe("OpenCodeRule", () => {
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

  describe("constructor", () => {
    it("should create instance with default parameters", () => {
      const opencodeRule = new OpenCodeRule({
        relativeDirPath: ".opencode/memories",
        relativeFilePath: "test-memory.md",
        fileContent: "# Test Memory\n\nThis is a test memory.",
      });

      expect(opencodeRule).toBeInstanceOf(OpenCodeRule);
      expect(opencodeRule.getRelativeDirPath()).toBe(".opencode/memories");
      expect(opencodeRule.getRelativeFilePath()).toBe("test-memory.md");
      expect(opencodeRule.getFileContent()).toBe("# Test Memory\n\nThis is a test memory.");
    });

    it("should create instance with custom baseDir", () => {
      const opencodeRule = new OpenCodeRule({
        baseDir: "/custom/path",
        relativeDirPath: ".opencode/memories",
        relativeFilePath: "custom-memory.md",
        fileContent: "# Custom Memory",
      });

      expect(opencodeRule.getFilePath()).toBe("/custom/path/.opencode/memories/custom-memory.md");
    });

    it("should create instance for root AGENTS.md file", () => {
      const opencodeRule = new OpenCodeRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Project Overview\n\nThis is the main OpenCode agent memory.",
        root: true,
      });

      expect(opencodeRule.getRelativeDirPath()).toBe(".");
      expect(opencodeRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(opencodeRule.getFileContent()).toBe(
        "# Project Overview\n\nThis is the main OpenCode agent memory.",
      );
      expect(opencodeRule.isRoot()).toBe(true);
    });

    it("should validate content by default", () => {
      expect(() => {
        const _instance = new OpenCodeRule({
          relativeDirPath: ".opencode/memories",
          relativeFilePath: "test.md",
          fileContent: "", // empty content should be valid since validate always returns success
        });
      }).not.toThrow();
    });

    it("should skip validation when requested", () => {
      expect(() => {
        const _instance = new OpenCodeRule({
          relativeDirPath: ".opencode/memories",
          relativeFilePath: "test.md",
          fileContent: "",
          validate: false,
        });
      }).not.toThrow();
    });

    it("should handle root rule parameter", () => {
      const opencodeRule = new OpenCodeRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Root Memory",
        root: true,
      });

      expect(opencodeRule.getFileContent()).toBe("# Root Memory");
      expect(opencodeRule.isRoot()).toBe(true);
    });
  });

  describe("fromFile", () => {
    it("should create instance from root AGENTS.md file", async () => {
      // Setup test file - for root, the file should be directly at baseDir/AGENTS.md
      const testContent = "# OpenCode Project\n\nProject overview and agent instructions.";
      await writeFileContent(join(testDir, "AGENTS.md"), testContent);

      const opencodeRule = await OpenCodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
      });

      expect(opencodeRule.getRelativeDirPath()).toBe(".");
      expect(opencodeRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(opencodeRule.getFileContent()).toBe(testContent);
      expect(opencodeRule.getFilePath()).toBe(join(testDir, "AGENTS.md"));
      expect(opencodeRule.isRoot()).toBe(true);
    });

    it("should create instance from memory file", async () => {
      // Setup test file
      const memoriesDir = join(testDir, ".opencode/memories");
      await ensureDir(memoriesDir);
      const testContent = "# Memory Rule\n\nContent from memory file.";
      await writeFileContent(join(memoriesDir, "memory-test.md"), testContent);

      const opencodeRule = await OpenCodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "memory-test.md",
      });

      expect(opencodeRule.getRelativeDirPath()).toBe(".opencode/memories");
      expect(opencodeRule.getRelativeFilePath()).toBe("memory-test.md");
      expect(opencodeRule.getFileContent()).toBe(testContent);
      expect(opencodeRule.getFilePath()).toBe(join(testDir, ".opencode/memories/memory-test.md"));
      expect(opencodeRule.isRoot()).toBe(false);
    });

    it("should use default baseDir when not provided", async () => {
      // Setup test file in test directory - process.cwd() is mocked to return testDir
      const testContent = "# Default BaseDir Test";
      await writeFileContent(join(testDir, "AGENTS.md"), testContent);

      const opencodeRule = await OpenCodeRule.fromFile({
        relativeFilePath: "AGENTS.md",
      });

      expect(opencodeRule.getRelativeDirPath()).toBe(".");
      expect(opencodeRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(opencodeRule.getFileContent()).toBe(testContent);
    });

    it("should handle validation parameter", async () => {
      const testContent = "# Validation Test";
      await writeFileContent(join(testDir, "AGENTS.md"), testContent);

      const opencodeRuleWithValidation = await OpenCodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
        validate: true,
      });

      const opencodeRuleWithoutValidation = await OpenCodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
        validate: false,
      });

      expect(opencodeRuleWithValidation.getFileContent()).toBe(testContent);
      expect(opencodeRuleWithoutValidation.getFileContent()).toBe(testContent);
    });

    it("should throw error when file does not exist", async () => {
      await expect(
        OpenCodeRule.fromFile({
          baseDir: testDir,
          relativeFilePath: "nonexistent.md",
        }),
      ).rejects.toThrow();
    });

    it("should detect root vs non-root files correctly", async () => {
      // Setup root AGENTS.md file and memory files
      const memoriesDir = join(testDir, ".opencode/memories");
      await ensureDir(memoriesDir);

      const rootContent = "# Root Project Overview";
      const memoryContent = "# Memory Rule";

      // Root file goes directly in baseDir
      await writeFileContent(join(testDir, "AGENTS.md"), rootContent);
      // Memory file goes in .opencode/memories
      await writeFileContent(join(memoriesDir, "memory.md"), memoryContent);

      const rootRule = await OpenCodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
      });

      const memoryRule = await OpenCodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "memory.md",
      });

      expect(rootRule.isRoot()).toBe(true);
      expect(rootRule.getRelativeDirPath()).toBe(".");
      expect(memoryRule.isRoot()).toBe(false);
      expect(memoryRule.getRelativeDirPath()).toBe(".opencode/memories");
    });
  });

  describe("fromRulesyncRule", () => {
    it("should create instance from RulesyncRule for root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test-rule.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Test root rule",
          globs: [],
        },
        body: "# Test RulesyncRule\n\nContent from rulesync.",
      });

      const opencodeRule = OpenCodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(opencodeRule).toBeInstanceOf(OpenCodeRule);
      expect(opencodeRule.getRelativeDirPath()).toBe(".");
      expect(opencodeRule.getRelativeFilePath()).toBe("AGENTS.md");
      expect(opencodeRule.getFileContent()).toContain(
        "# Test RulesyncRule\n\nContent from rulesync.",
      );
      expect(opencodeRule.isRoot()).toBe(true);
    });

    it("should create instance from RulesyncRule for non-root rule", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "detail-rule.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Test detail rule",
          globs: [],
        },
        body: "# Detail RulesyncRule\n\nContent from detail rulesync.",
      });

      const opencodeRule = OpenCodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(opencodeRule).toBeInstanceOf(OpenCodeRule);
      expect(opencodeRule.getRelativeDirPath()).toBe(".opencode/memories");
      expect(opencodeRule.getRelativeFilePath()).toBe("detail-rule.md");
      expect(opencodeRule.getFileContent()).toContain(
        "# Detail RulesyncRule\n\nContent from detail rulesync.",
      );
      expect(opencodeRule.isRoot()).toBe(false);
    });

    it("should use custom baseDir", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "custom-base.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Custom Base Directory",
      });

      const opencodeRule = OpenCodeRule.fromRulesyncRule({
        baseDir: "/custom/base",
        rulesyncRule,
      });

      expect(opencodeRule.getFilePath()).toBe("/custom/base/.opencode/memories/custom-base.md");
    });

    it("should handle validation parameter", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "validation.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "",
          globs: [],
        },
        body: "# Validation Test",
      });

      const opencodeRuleWithValidation = OpenCodeRule.fromRulesyncRule({
        rulesyncRule,
        validate: true,
      });

      const opencodeRuleWithoutValidation = OpenCodeRule.fromRulesyncRule({
        rulesyncRule,
        validate: false,
      });

      expect(opencodeRuleWithValidation.getFileContent()).toContain("# Validation Test");
      expect(opencodeRuleWithoutValidation.getFileContent()).toContain("# Validation Test");
    });

    it("should convert categorized agent from rulesync to opencode", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          root: false,
          targets: ["opencode"],
          description: "Test Agent",
          opencode: {
            category: "governance",
            mode: "subagent",
            model: "anthropic/claude-sonnet-4-20250514",
            temperature: 0.5,
            capabilities: ["read", "edit"],
            mcp_servers: ["context7"],
            delegates_to: ["other-agent"],
            accepts_from: ["all-agents"],
          },
        },
        body: "# Test Agent\n\nAgent content here.",
      });

      const opencodeRule = OpenCodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(opencodeRule).toBeInstanceOf(OpenCodeRule);
      expect(opencodeRule.getRelativeDirPath()).toBe(".opencode/agent");
      expect(opencodeRule.getRelativeFilePath()).toBe("governance/test-agent.md");
      expect(opencodeRule.getDescription()).toBe("Test Agent");
      
      // Verify frontmatter is reconstructed
      const fileContent = opencodeRule.getFileContent();
      expect(fileContent).toContain("mode: subagent");
      expect(fileContent).toContain("model: anthropic/claude-sonnet-4-20250514");
      expect(fileContent).toContain("temperature: 0.5");
      expect(fileContent).toContain("# Test Agent");
      
      // Verify agentEntry is reconstructed
      const rule = opencodeRule as any;
      expect(rule.agentEntry).toBeDefined();
      expect(rule.agentEntry.slug).toBe("test-agent");
      expect(rule.agentEntry.name).toBe("Test Agent");
      expect(rule.agentEntry.category).toBe("governance");
      expect(rule.agentEntry.capabilities).toEqual(["read", "edit"]);
      expect(rule.agentEntry.mcp_servers).toEqual(["context7"]);
    });

    it("should convert root-level agent (empty category) from rulesync to opencode", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "root-agent.md",
        frontmatter: {
          root: false,
          targets: ["opencode"],
          description: "Root Agent",
          opencode: {
            category: "",
            mode: "primary",
            model: "openrouter/anthropic/claude-3.5-sonnet",
          },
        },
        body: "# Root Agent\n\nRoot level agent content.",
      });

      const opencodeRule = OpenCodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(opencodeRule.getRelativeFilePath()).toBe("root-agent.md"); // No category in path
      expect(opencodeRule.getDescription()).toBe("Root Agent");
      
      const rule = opencodeRule as any;
      expect(rule.agentEntry).toBeDefined();
      expect(rule.agentEntry.category).toBeUndefined(); // Empty string becomes undefined
    });

    it("should preserve all frontmatter fields when converting agent", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "full-agent.md",
        frontmatter: {
          root: false,
          targets: ["opencode"],
          description: "Full Agent",
          opencode: {
            category: "planning",
            mode: "all",
            model: "anthropic/claude-sonnet-4-20250514",
            temperature: 0.7,
            topP: 0.9,
            color: "#FF5733",
            maxSteps: 10,
            tools: {
              read: true,
              edit: true,
              bash: true,
            },
            permission: {
              edit: "ask",
              bash: {
                "*": "allow",
              },
            },
            options: {
              custom: "value",
            },
          },
        },
        body: "# Full Agent\n\nFull content.",
      });

      const opencodeRule = OpenCodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      const fileContent = opencodeRule.getFileContent();
      expect(fileContent).toContain("mode: all");
      expect(fileContent).toContain("model: anthropic/claude-sonnet-4-20250514");
      expect(fileContent).toContain("temperature: 0.7");
      expect(fileContent).toContain("topP: 0.9");
      expect(fileContent).toContain('color: "#FF5733"');
      expect(fileContent).toContain("maxSteps: 10");
    });

    it("should handle missing optional fields when converting agent", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "minimal-agent.md",
        frontmatter: {
          root: false,
          targets: ["opencode"],
          description: "Minimal Agent",
          opencode: {
            category: "general",
            mode: "subagent",
            // No other fields
          },
        },
        body: "# Minimal Agent\n\nMinimal content.",
      });

      const opencodeRule = OpenCodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      expect(opencodeRule.getRelativeFilePath()).toBe("general/minimal-agent.md");
      const fileContent = opencodeRule.getFileContent();
      expect(fileContent).toContain("mode: subagent");
      // Should not contain undefined fields
      expect(fileContent).not.toContain("temperature: undefined");
    });

    it("should handle non-agent rulesync rule (no opencode metadata)", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
        relativeFilePath: "regular-rule.md",
        frontmatter: {
          root: false,
          targets: ["opencode"],
          description: "Regular Rule",
          // No opencode metadata
        },
        body: "# Regular Rule\n\nRegular content.",
      });

      const opencodeRule = OpenCodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      // Should use default conversion (not agent conversion)
      expect(opencodeRule.getRelativeDirPath()).toBe(".opencode/memories");
      expect(opencodeRule.getRelativeFilePath()).toBe("regular-rule.md");
    });

    it("should handle rulesync rule with opencode metadata but wrong directory", () => {
      const rulesyncRule = new RulesyncRule({
        relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH, // Not subagents directory
        relativeFilePath: "wrong-dir-agent.md",
        frontmatter: {
          root: false,
          targets: ["opencode"],
          description: "Wrong Dir Agent",
          opencode: {
            category: "governance",
            mode: "subagent",
          },
        },
        body: "# Wrong Dir Agent",
      });

      const opencodeRule = OpenCodeRule.fromRulesyncRule({
        rulesyncRule,
      });

      // Should use default conversion since it's not in subagents directory
      expect(opencodeRule.getRelativeDirPath()).toBe(".opencode/memories");
    });
  });

  describe("toRulesyncRule", () => {
    it("should convert OpenCodeRule to RulesyncRule for root rule", () => {
      const opencodeRule = new OpenCodeRule({
        baseDir: testDir,
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Convert Test\n\nThis will be converted.",
        root: true,
      });

      const rulesyncRule = opencodeRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("AGENTS.md"); // OpenCode uses AGENTS.md for root
      expect(rulesyncRule.getFileContent()).toContain("# Convert Test\n\nThis will be converted.");
    });

    it("should convert OpenCodeRule to RulesyncRule for memory rule", () => {
      const opencodeRule = new OpenCodeRule({
        baseDir: testDir,
        relativeDirPath: ".opencode/memories",
        relativeFilePath: "memory-convert.md",
        fileContent: "# Memory Convert Test\n\nThis memory will be converted.",
        root: false,
      });

      const rulesyncRule = opencodeRule.toRulesyncRule();

      expect(rulesyncRule).toBeInstanceOf(RulesyncRule);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("memory-convert.md");
      expect(rulesyncRule.getFileContent()).toContain(
        "# Memory Convert Test\n\nThis memory will be converted.",
      );
    });

    it("should preserve metadata in conversion", () => {
      const opencodeRule = new OpenCodeRule({
        baseDir: "/test/path",
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Metadata Test\n\nWith metadata preserved.",
        root: true,
      });

      const rulesyncRule = opencodeRule.toRulesyncRule();

      expect(rulesyncRule.getFilePath()).toBe(
        join("/test/path", RULESYNC_RULES_RELATIVE_DIR_PATH, "AGENTS.md"), // OpenCode uses AGENTS.md
      );
      expect(rulesyncRule.getFileContent()).toContain(
        "# Metadata Test\n\nWith metadata preserved.",
      );
    });
  });

  describe("validate", () => {
    it("should always return success", () => {
      const opencodeRule = new OpenCodeRule({
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
        fileContent: "# Any content is valid",
      });

      const result = opencodeRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for empty content", () => {
      const opencodeRule = new OpenCodeRule({
        relativeDirPath: ".opencode/memories",
        relativeFilePath: "empty.md",
        fileContent: "",
      });

      const result = opencodeRule.validate();

      expect(result.success).toBe(true);
      expect(result.error).toBeNull();
    });

    it("should return success for any content format", () => {
      const contents = [
        "# Markdown content",
        "Plain text content",
        "---\nfrontmatter: true\n---\nContent with frontmatter",
        "/* Code comments */",
        "Invalid markdown ### ###",
        "Special characters: éñ中文🎉",
        "Multi-line\ncontent\nwith\nbreaks",
      ];

      for (const content of contents) {
        const opencodeRule = new OpenCodeRule({
          relativeDirPath: ".",
          relativeFilePath: "AGENTS.md",
          fileContent: content,
        });

        const result = opencodeRule.validate();
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      }
    });
  });

  describe("integration tests", () => {
    it("should handle complete workflow from file to rulesync rule", async () => {
      // Create original file
      const originalContent = "# Integration Test\n\nComplete workflow test.";
      await writeFileContent(join(testDir, "AGENTS.md"), originalContent);

      // Load from file
      const opencodeRule = await OpenCodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "AGENTS.md",
      });

      // Convert to rulesync rule
      const rulesyncRule = opencodeRule.toRulesyncRule();

      // Verify conversion
      expect(rulesyncRule.getFileContent()).toContain(originalContent);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("AGENTS.md"); // OpenCode uses AGENTS.md for root
    });

    it("should handle complete workflow from memory file to rulesync rule", async () => {
      // Create memory file
      const memoriesDir = join(testDir, ".opencode/memories");
      await ensureDir(memoriesDir);
      const originalContent = "# Memory Integration Test\n\nMemory workflow test.";
      await writeFileContent(join(memoriesDir, "memory-integration.md"), originalContent);

      // Load from file
      const opencodeRule = await OpenCodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "memory-integration.md",
      });

      // Convert to rulesync rule
      const rulesyncRule = opencodeRule.toRulesyncRule();

      // Verify conversion
      expect(rulesyncRule.getFileContent()).toContain(originalContent);
      expect(rulesyncRule.getRelativeDirPath()).toBe(RULESYNC_RULES_RELATIVE_DIR_PATH);
      expect(rulesyncRule.getRelativeFilePath()).toBe("memory-integration.md");
    });

    it("should handle roundtrip conversion rulesync -> opencode -> rulesync", () => {
      const originalBody = "# Roundtrip Test\n\nContent should remain the same.";

      // Start with rulesync rule (root)
      const originalRulesync = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "roundtrip.md",
        frontmatter: {
          root: true,
          targets: ["*"],
          description: "Roundtrip test",
          globs: [],
        },
        body: originalBody,
      });

      // Convert to opencode rule
      const opencodeRule = OpenCodeRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesync,
      });

      // Convert back to rulesync rule
      const finalRulesync = opencodeRule.toRulesyncRule();

      // Verify content preservation
      expect(finalRulesync.getFileContent()).toContain(originalBody);
      expect(finalRulesync.getRelativeFilePath()).toBe("AGENTS.md"); // OpenCode uses AGENTS.md for root
    });

    it("should handle roundtrip conversion rulesync -> opencode -> rulesync for detail rule", () => {
      const originalBody = "# Detail Roundtrip Test\n\nDetail content should remain the same.";

      // Start with rulesync rule (non-root)
      const originalRulesync = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "detail-roundtrip.md",
        frontmatter: {
          root: false,
          targets: ["*"],
          description: "Detail roundtrip test",
          globs: [],
        },
        body: originalBody,
      });

      // Convert to opencode rule
      const opencodeRule = OpenCodeRule.fromRulesyncRule({
        baseDir: testDir,
        rulesyncRule: originalRulesync,
      });

      // Convert back to rulesync rule
      const finalRulesync = opencodeRule.toRulesyncRule();

      // Verify content preservation
      expect(finalRulesync.getFileContent()).toContain(originalBody);
      expect(finalRulesync.getRelativeFilePath()).toBe("detail-roundtrip.md");
    });

    it("should preserve directory structure in file paths", async () => {
      // Test nested directory structure
      const nestedDir = join(testDir, ".opencode/memories/nested");
      await ensureDir(nestedDir);
      const content = "# Nested Rule\n\nIn a nested directory.";
      await writeFileContent(join(nestedDir, "nested-rule.md"), content);

      // This should work with the current implementation since fromFile
      // determines path based on the relativeFilePath parameter
      const opencodeRule = await OpenCodeRule.fromFile({
        baseDir: testDir,
        relativeFilePath: "nested/nested-rule.md",
      });

      expect(opencodeRule.getRelativeDirPath()).toBe(".opencode/memories");
      expect(opencodeRule.getRelativeFilePath()).toBe("nested/nested-rule.md");
      expect(opencodeRule.getFileContent()).toBe(content);
    });
  });

  describe("edge cases", () => {
    it("should handle files with special characters in names", () => {
      const opencodeRule = new OpenCodeRule({
        relativeDirPath: ".opencode/memories",
        relativeFilePath: "special-chars@#$.md",
        fileContent: "# Special chars in filename",
      });

      expect(opencodeRule.getRelativeFilePath()).toBe("special-chars@#$.md");
    });

    it("should handle very long content", () => {
      const longContent = "# Long Content\n\n" + "A".repeat(10000);
      const opencodeRule = new OpenCodeRule({
        relativeDirPath: ".opencode/memories",
        relativeFilePath: "long-content.md",
        fileContent: longContent,
      });

      expect(opencodeRule.getFileContent()).toBe(longContent);
      expect(opencodeRule.validate().success).toBe(true);
    });

    it("should handle content with various line endings", () => {
      const contentVariations = [
        "Line 1\nLine 2\nLine 3", // Unix
        "Line 1\r\nLine 2\r\nLine 3", // Windows
        "Line 1\rLine 2\rLine 3", // Old Mac
        "Mixed\nLine\r\nEndings\rHere", // Mixed
      ];

      for (const content of contentVariations) {
        const opencodeRule = new OpenCodeRule({
          relativeDirPath: ".opencode/memories",
          relativeFilePath: "line-endings.md",
          fileContent: content,
        });

        expect(opencodeRule.validate().success).toBe(true);
        expect(opencodeRule.getFileContent()).toBe(content);
      }
    });

    it("should handle Unicode content", () => {
      const unicodeContent =
        "# Unicode Test 🚀\n\nEmojis: 😀🎉\nChinese: 你好世界\nArabic: مرحبا بالعالم\nRussian: Привет мир";
      const opencodeRule = new OpenCodeRule({
        relativeDirPath: ".opencode/memories",
        relativeFilePath: "unicode.md",
        fileContent: unicodeContent,
      });

      expect(opencodeRule.getFileContent()).toBe(unicodeContent);
      expect(opencodeRule.validate().success).toBe(true);
    });
  });

  describe("isTargetedByRulesyncRule", () => {
    it("should return true for rules targeting opencode", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["opencode"],
        },
        body: "Test content",
      });

      expect(OpenCodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return true for rules targeting all tools (*)", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
        },
        body: "Test content",
      });

      expect(OpenCodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should return false for rules not targeting opencode", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "copilot"],
        },
        body: "Test content",
      });

      expect(OpenCodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should return false for empty targets", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: [],
        },
        body: "Test content",
      });

      expect(OpenCodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(false);
    });

    it("should handle mixed targets including opencode", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["cursor", "opencode", "copilot"],
        },
        body: "Test content",
      });

      expect(OpenCodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });

    it("should handle undefined targets in frontmatter", () => {
      const rulesyncRule = new RulesyncRule({
        baseDir: testDir,
        relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {},
        body: "Test content",
      });

      expect(OpenCodeRule.isTargetedByRulesyncRule(rulesyncRule)).toBe(true);
    });
  });

  describe("fromAgent", () => {
    it("should create OpenCodeRule from agent registry entry", async () => {
      const agentDir = join(testDir, ".opencode/agent/governance");
      await ensureDir(agentDir);

      const agentContent = `---
description: Test agent for governance
mode: subagent
model: anthropic/claude-sonnet-4-20250514
temperature: 0.5
tools:
  read: true
  edit: false
---

# Test Agent

This is a test agent for governance tasks.
`;

      await writeFileContent(join(agentDir, "test-agent.md"), agentContent);

      const agentEntry: OpenCodeAgentRegistryEntry = {
        slug: "test-agent",
        name: "Test Agent",
        file: ".opencode/agent/governance/test-agent.md",
        category: "governance",
        capabilities: ["read", "edit"],
        mcp_servers: [],
        delegates_to: [],
        accepts_from: ["all-agents"],
      };

      const opencodeRule = await OpenCodeRule.fromAgent({
        baseDir: testDir,
        agentEntry,
      });

      expect(opencodeRule).toBeInstanceOf(OpenCodeRule);
      expect(opencodeRule.getRelativeDirPath()).toBe(".opencode/agent");
      expect(opencodeRule.getRelativeFilePath()).toBe("governance/test-agent.md");
      expect(opencodeRule.getFileContent()).toBe(agentContent);
      expect(opencodeRule.isRoot()).toBe(false);
      expect(opencodeRule.getDescription()).toBe("Test Agent");
    });

    it("should extract category and slug from file path correctly", async () => {
      const agentDir = join(testDir, ".opencode/agent/planning");
      await ensureDir(agentDir);

      const agentContent = `---
description: Planning agent
mode: primary
---

# Planning Agent
`;

      await writeFileContent(join(agentDir, "product-strategist.md"), agentContent);

      const agentEntry: OpenCodeAgentRegistryEntry = {
        slug: "product-strategist",
        name: "Product Strategist",
        file: ".opencode/agent/planning/product-strategist.md",
        category: "planning",
      };

      const opencodeRule = await OpenCodeRule.fromAgent({
        baseDir: testDir,
        agentEntry,
      });

      expect(opencodeRule.getRelativeFilePath()).toBe("planning/product-strategist.md");
    });

    it("should handle agent entry with all optional fields", async () => {
      const agentDir = join(testDir, ".opencode/agent/implementation");
      await ensureDir(agentDir);

      const agentContent = `---
description: Implementation specialist
mode: all
model: openrouter/anthropic/claude-3.5-sonnet
temperature: 0.7
tools:
  read: true
  edit: true
  bash: true
---

# Implementation Specialist

Handles code implementation tasks.
`;

      await writeFileContent(join(agentDir, "implementation-specialist.md"), agentContent);

      const agentEntry: OpenCodeAgentRegistryEntry = {
        slug: "implementation-specialist",
        name: "Implementation Specialist",
        file: ".opencode/agent/implementation/implementation-specialist.md",
        category: "implementation",
        capabilities: ["read", "edit", "command", "browser", "mcp"],
        mcp_servers: ["context7", "chrome-devtools"],
        delegates_to: ["code-reviewer", "test-engineer"],
        accepts_from: ["strategic-architect", "quick-fixer"],
      };

      const opencodeRule = await OpenCodeRule.fromAgent({
        baseDir: testDir,
        agentEntry,
      });

      expect(opencodeRule.getRelativeFilePath()).toBe("implementation/implementation-specialist.md");
      expect(opencodeRule.getFileContent()).toBe(agentContent);
    });

    it("should throw error when agent file does not exist", async () => {
      const agentEntry: OpenCodeAgentRegistryEntry = {
        slug: "missing-agent",
        name: "Missing Agent",
        file: ".opencode/agent/governance/missing-agent.md",
        category: "governance",
      };

      await expect(
        OpenCodeRule.fromAgent({
          baseDir: testDir,
          agentEntry,
        }),
      ).rejects.toThrow();
    });

    it("should reject path traversal attempts in agentEntry.file", async () => {
      const agentEntry: OpenCodeAgentRegistryEntry = {
        slug: "malicious-agent",
        name: "Malicious Agent",
        file: "../sensitive-file.md", // Path traversal attempt
        category: "governance",
      };

      await expect(
        OpenCodeRule.fromAgent({
          baseDir: testDir,
          agentEntry,
        }),
      ).rejects.toThrow("Path traversal detected");
    });

    it("should reject path traversal with .. segments", async () => {
      const agentEntry: OpenCodeAgentRegistryEntry = {
        slug: "traversal-agent",
        name: "Traversal Agent",
        file: ".opencode/agent/../../etc/passwd", // Path traversal attempt
        category: "governance",
      };

      await expect(
        OpenCodeRule.fromAgent({
          baseDir: testDir,
          agentEntry,
        }),
      ).rejects.toThrow("Path traversal detected");
    });
  });

  describe("toRulesyncRule with agent metadata", () => {
    it("should preserve agent frontmatter in rulesync format", () => {
      const agentContent = `---
description: Test agent description
mode: subagent
model: anthropic/claude-sonnet-4-20250514
temperature: 0.5
topP: 0.9
color: "#FF5733"
maxSteps: 10
tools:
  read: true
  edit: false
  bash: true
permission:
  edit: ask
  bash:
    "*": allow
---

# Agent Instructions

Agent body content here.
`;

      const agentEntry: OpenCodeAgentRegistryEntry = {
        slug: "test-agent",
        name: "Test Agent",
        file: ".opencode/agent/governance/test-agent.md",
        category: "governance",
        capabilities: ["read", "edit"],
        mcp_servers: ["context7"],
        delegates_to: ["other-agent"],
        accepts_from: ["all-agents"],
      };

      const opencodeRule = new OpenCodeRule({
        baseDir: testDir,
        relativeDirPath: ".opencode/agent",
        relativeFilePath: "governance/test-agent.md",
        fileContent: agentContent,
        root: false,
        description: "Test Agent",
        agentEntry,
      });

      const rulesyncRule = opencodeRule.toRulesyncRule();

      expect(rulesyncRule.getFrontmatter().root).toBe(false);
      expect(rulesyncRule.getFrontmatter().targets).toEqual(["opencode"]);
      expect(rulesyncRule.getFrontmatter().description).toBe("Test Agent");

      const opencodeMetadata = rulesyncRule.getFrontmatter().opencode as Record<string, unknown>;
      expect(opencodeMetadata).toBeDefined();
      expect(opencodeMetadata.mode).toBe("subagent");
      expect(opencodeMetadata.model).toBe("anthropic/claude-sonnet-4-20250514");
      expect(opencodeMetadata.temperature).toBe(0.5);
      expect(opencodeMetadata.topP).toBe(0.9);
      expect(opencodeMetadata.color).toBe("#FF5733");
      expect(opencodeMetadata.maxSteps).toBe(10);
      expect(opencodeMetadata.tools).toEqual({
        read: true,
        edit: false,
        bash: true,
      });
      expect(opencodeMetadata.permission).toEqual({
        edit: "ask",
        bash: {
          "*": "allow",
        },
      });

      // Registry metadata
      expect(opencodeMetadata.category).toBe("governance");
      expect(opencodeMetadata.capabilities).toEqual(["read", "edit"]);
      expect(opencodeMetadata.mcp_servers).toEqual(["context7"]);
      expect(opencodeMetadata.delegates_to).toEqual(["other-agent"]);
      expect(opencodeMetadata.accepts_from).toEqual(["all-agents"]);

      expect(rulesyncRule.getBody()).toBe("\n# Agent Instructions\n\nAgent body content here.\n");
    });

    it("should handle agent without registry entry", () => {
      const agentContent = `---
description: Simple agent
mode: primary
---

# Simple Agent

Simple content.
`;

      const opencodeRule = new OpenCodeRule({
        baseDir: testDir,
        relativeDirPath: ".opencode/agent",
        relativeFilePath: "simple-agent.md",
        fileContent: agentContent,
        root: false,
      });

      const rulesyncRule = opencodeRule.toRulesyncRule();

      expect(rulesyncRule.getFrontmatter().opencode).toBeUndefined();
      expect(rulesyncRule.getFrontmatter().description).toBe("");
    });

    it("should handle agent with minimal frontmatter", () => {
      const agentContent = `---
description: Minimal agent
---

# Minimal Agent

Content only.
`;

      const agentEntry: OpenCodeAgentRegistryEntry = {
        slug: "minimal",
        name: "Minimal Agent",
        file: ".opencode/agent/minimal.md",
        category: "general",
      };

      const opencodeRule = new OpenCodeRule({
        baseDir: testDir,
        relativeDirPath: ".opencode/agent",
        relativeFilePath: "minimal.md",
        fileContent: agentContent,
        root: false,
        agentEntry,
      });

      const rulesyncRule = opencodeRule.toRulesyncRule();

      const opencodeMetadata = rulesyncRule.getFrontmatter().opencode as Record<string, unknown>;
      expect(opencodeMetadata).toBeDefined();
      expect(opencodeMetadata.category).toBe("general");
      expect(opencodeMetadata.mode).toBeUndefined();
      expect(opencodeMetadata.model).toBeUndefined();
    });

    it("should only include optional registry fields if they exist", () => {
      const agentContent = `---
description: Agent without optional fields
mode: subagent
---

# Agent Content
`;

      const agentEntry: OpenCodeAgentRegistryEntry = {
        slug: "simple",
        name: "Simple Agent",
        file: ".opencode/agent/simple.md",
        category: "general",
        // No optional fields
      };

      const opencodeRule = new OpenCodeRule({
        baseDir: testDir,
        relativeDirPath: ".opencode/agent",
        relativeFilePath: "simple.md",
        fileContent: agentContent,
        root: false,
        agentEntry,
      });

      const rulesyncRule = opencodeRule.toRulesyncRule();

      const opencodeMetadata = rulesyncRule.getFrontmatter().opencode as Record<string, unknown>;
      expect(opencodeMetadata.category).toBe("general");
      expect(opencodeMetadata.mode).toBe("subagent");
      expect(opencodeMetadata.capabilities).toBeUndefined();
      expect(opencodeMetadata.mcp_servers).toBeUndefined();
      expect(opencodeMetadata.delegates_to).toBeUndefined();
      expect(opencodeMetadata.accepts_from).toBeUndefined();
    });
  });
});
