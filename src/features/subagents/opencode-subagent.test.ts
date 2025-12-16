import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { setupTestDirectory } from "../../test-utils/test-directories.js";
import { ensureDir, writeFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import type { OpenCodeAgentRegistryEntry } from "./opencode-agent-registry.js";
import {
  OpenCodeSubagent,
  type OpenCodeSubagentFrontmatter,
  OpenCodeSubagentFrontmatterSchema,
} from "./opencode-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";

describe("OpenCodeSubagentFrontmatterSchema", () => {
  it("should accept valid frontmatter with required description field", () => {
    const validFrontmatter = {
      description: "A test agent",
    };

    expect(() => OpenCodeSubagentFrontmatterSchema.parse(validFrontmatter)).not.toThrow();
  });

  it("should accept valid frontmatter with optional fields", () => {
    const frontmatterWithOptions = {
      description: "A test agent",
      mode: "subagent",
      model: "anthropic/claude-sonnet-4-20250514",
      temperature: 0.5,
      topP: 0.9,
      color: "#FF5733",
      maxSteps: 10,
    };

    expect(() => OpenCodeSubagentFrontmatterSchema.parse(frontmatterWithOptions)).not.toThrow();
  });

  it("should reject frontmatter missing required description field", () => {
    const missingDescription = {};
    expect(() => OpenCodeSubagentFrontmatterSchema.parse(missingDescription)).toThrow();
  });
});

describe("OpenCodeSubagent", () => {
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
    it("should create instance with required parameters", () => {
      const frontmatter: OpenCodeSubagentFrontmatter = {
        description: "Test agent",
      };
      const subagent = new OpenCodeSubagent({
        relativeDirPath: ".opencode/agent",
        relativeFilePath: "test-agent.md",
        fileContent: "# Test Agent\n\nContent here.",
        frontmatter,
        body: "# Test Agent\n\nContent here.",
      });

      expect(subagent).toBeInstanceOf(OpenCodeSubagent);
      expect(subagent.getRelativeDirPath()).toBe(".opencode/agent");
      expect(subagent.getRelativeFilePath()).toBe("test-agent.md");
    });

    it("should create instance with agentEntry", () => {
      const frontmatter: OpenCodeSubagentFrontmatter = {
        description: "Test agent",
      };
      const agentEntry: OpenCodeAgentRegistryEntry = {
        slug: "test-agent",
        name: "Test Agent",
        file: ".opencode/agent/test-agent.md",
        category: "",
        capabilities: ["read", "edit"],
      };
      const subagent = new OpenCodeSubagent({
        relativeDirPath: ".opencode/agent",
        relativeFilePath: "test-agent.md",
        fileContent: "# Test Agent",
        frontmatter,
        body: "# Test Agent",
        agentEntry,
      });

      expect(subagent.getAgentEntry()).toBeDefined();
      expect(subagent.getAgentEntry()?.slug).toBe("test-agent");
    });
  });

  describe("getSettablePaths", () => {
    it("should return correct paths for OpenCode agents", () => {
      const paths = OpenCodeSubagent.getSettablePaths();
      expect(paths.relativeDirPath).toBe(".opencode/agent");
    });
  });

  describe("fromFile", () => {
    it("should load agent file from filesystem", async () => {
      const agentDir = join(testDir, ".opencode", "agent");
      await ensureDir(agentDir);
      const agentContent = stringifyFrontmatter("# Agent Content", {
        description: "Test Agent",
        mode: "subagent",
      });
      await writeFileContent(join(agentDir, "test-agent.md"), agentContent);

      const subagent = await OpenCodeSubagent.fromFile({
        baseDir: testDir,
        relativeFilePath: "test-agent.md",
      });

      expect(subagent).toBeInstanceOf(OpenCodeSubagent);
      expect(subagent.getRelativeFilePath()).toBe("test-agent.md");
      expect(subagent.getFrontmatter().description).toBe("Test Agent");
    });
  });

  describe("fromAgent", () => {
    it("should create OpenCodeSubagent from agent registry entry", async () => {
      const agentDir = join(testDir, ".opencode", "agent");
      await ensureDir(agentDir);
      const agentContent = stringifyFrontmatter("# Test Agent\n\nContent here.", {
        description: "Test Agent",
        mode: "subagent",
      });
      await writeFileContent(join(agentDir, "test-agent.md"), agentContent);

      const agentEntry: OpenCodeAgentRegistryEntry = {
        slug: "test-agent",
        name: "Test Agent",
        file: ".opencode/agent/test-agent.md",
        category: "",
      };

      const subagent = await OpenCodeSubagent.fromAgent({
        baseDir: testDir,
        agentEntry,
      });

      expect(subagent).toBeInstanceOf(OpenCodeSubagent);
      expect(subagent.getRelativeFilePath()).toBe("test-agent.md");
      expect(subagent.getAgentEntry()?.slug).toBe("test-agent");
    });

    it("should handle categorized agent", async () => {
      const agentDir = join(testDir, ".opencode", "agent", "governance");
      await ensureDir(agentDir);
      const agentContent = stringifyFrontmatter("# Product Strategist", {
        description: "Product Strategist",
      });
      await writeFileContent(join(agentDir, "product-strategist.md"), agentContent);

      const agentEntry: OpenCodeAgentRegistryEntry = {
        slug: "product-strategist",
        name: "Product Strategist",
        file: ".opencode/agent/governance/product-strategist.md",
        category: "governance",
      };

      const subagent = await OpenCodeSubagent.fromAgent({
        baseDir: testDir,
        agentEntry,
      });

      expect(subagent.getRelativeFilePath()).toBe("governance/product-strategist.md");
      expect(subagent.getAgentEntry()?.category).toBe("governance");
    });

    it("should handle agent entry with all optional fields", async () => {
      const agentDir = join(testDir, ".opencode", "agent", "implementation");
      await ensureDir(agentDir);
      const agentContent = stringifyFrontmatter("# Implementation Specialist", {
        description: "Implementation Specialist",
        mode: "all",
        model: "anthropic/claude-sonnet-4-20250514",
      });
      await writeFileContent(join(agentDir, "implementation-specialist.md"), agentContent);

      const agentEntry: OpenCodeAgentRegistryEntry = {
        slug: "implementation-specialist",
        name: "Implementation Specialist",
        file: ".opencode/agent/implementation/implementation-specialist.md",
        category: "implementation",
        capabilities: ["read", "edit", "command"],
        mcp_servers: ["context7"],
        delegates_to: ["other-agent"],
        accepts_from: ["all-agents"],
      };

      const subagent = await OpenCodeSubagent.fromAgent({
        baseDir: testDir,
        agentEntry,
      });

      expect(subagent.getAgentEntry()?.capabilities).toEqual(["read", "edit", "command"]);
      expect(subagent.getAgentEntry()?.mcp_servers).toEqual(["context7"]);
    });

    it("should throw error when agent file does not exist", async () => {
      const agentEntry: OpenCodeAgentRegistryEntry = {
        slug: "missing-agent",
        name: "Missing Agent",
        file: ".opencode/agent/missing-agent.md",
        category: "",
      };

      await expect(
        OpenCodeSubagent.fromAgent({
          baseDir: testDir,
          agentEntry,
        }),
      ).rejects.toThrow();
    });

    it("should reject path traversal attempts in agentEntry.file", async () => {
      const agentEntry: OpenCodeAgentRegistryEntry = {
        slug: "malicious",
        name: "Malicious",
        file: "../../../etc/passwd",
        category: "",
      };

      await expect(
        OpenCodeSubagent.fromAgent({
          baseDir: testDir,
          agentEntry,
        }),
      ).rejects.toThrow();
    });

    it("should warn on category mismatch", async () => {
      const agentDir = join(testDir, ".opencode", "agent", "planning");
      await ensureDir(agentDir);
      const agentContent = stringifyFrontmatter("# Test", { description: "Test" });
      await writeFileContent(join(agentDir, "test.md"), agentContent);

      const agentEntry: OpenCodeAgentRegistryEntry = {
        slug: "test",
        name: "Test",
        file: ".opencode/agent/planning/test.md",
        category: "governance",
      };

      await OpenCodeSubagent.fromAgent({
        baseDir: testDir,
        agentEntry,
      });
    });
  });

  describe("toRulesyncSubagent", () => {
    it("should convert OpenCodeSubagent to RulesyncSubagent with opencode metadata", () => {
      const agentEntry: OpenCodeAgentRegistryEntry = {
        slug: "test-agent",
        name: "Test Agent",
        file: ".opencode/agent/test-agent.md",
        category: "governance",
        capabilities: ["read", "edit"],
        mcp_servers: ["context7"],
      };
      const frontmatter: OpenCodeSubagentFrontmatter = {
        description: "Test Agent",
        mode: "subagent",
        model: "anthropic/claude-sonnet-4-20250514",
      };
      const subagent = new OpenCodeSubagent({
        relativeDirPath: ".opencode/agent",
        relativeFilePath: "governance/test-agent.md",
        fileContent: "# Test Agent",
        frontmatter,
        body: "# Test Agent",
        agentEntry,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();

      expect(rulesyncSubagent).toBeInstanceOf(RulesyncSubagent);
      expect(rulesyncSubagent.getRelativeFilePath()).toBe("test-agent");
      const frontmatterResult = rulesyncSubagent.getFrontmatter();
      expect(frontmatterResult.targets).toEqual(["opencode"]);
      expect(frontmatterResult.name).toBe("test-agent");
      expect(frontmatterResult.description).toBe("Test Agent");
      expect(frontmatterResult.opencode).toBeDefined();
      const opencode = frontmatterResult.opencode as Record<string, unknown>;
      expect(opencode.category).toBe("governance");
      expect(opencode.capabilities).toEqual(["read", "edit"]);
      expect(opencode.mcp_servers).toEqual(["context7"]);
      expect(opencode.mode).toBe("subagent");
    });

    it("should handle root-level agent (empty category)", () => {
      const agentEntry: OpenCodeAgentRegistryEntry = {
        slug: "root-agent",
        name: "Root Agent",
        file: ".opencode/agent/root-agent.md",
        category: "",
      };
      const frontmatter: OpenCodeSubagentFrontmatter = {
        description: "Root Agent",
      };
      const subagent = new OpenCodeSubagent({
        relativeDirPath: ".opencode/agent",
        relativeFilePath: "root-agent.md",
        fileContent: "# Root Agent",
        frontmatter,
        body: "# Root Agent",
        agentEntry,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      const opencode = rulesyncSubagent.getFrontmatter().opencode as Record<string, unknown>;
      expect(opencode.category).toBe("");
    });

    it("should preserve all frontmatter fields", () => {
      const agentEntry: OpenCodeAgentRegistryEntry = {
        slug: "full-agent",
        name: "Full Agent",
        file: ".opencode/agent/full-agent.md",
        category: "planning",
      };
      const frontmatter: OpenCodeSubagentFrontmatter = {
        description: "Full Agent",
        mode: "all",
        model: "anthropic/claude-sonnet-4-20250514",
        temperature: 0.7,
        topP: 0.9,
        color: "#FF5733",
        maxSteps: 10,
      };
      const subagent = new OpenCodeSubagent({
        relativeDirPath: ".opencode/agent",
        relativeFilePath: "planning/full-agent.md",
        fileContent: "# Full Agent",
        frontmatter,
        body: "# Full Agent",
        agentEntry,
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      const opencode = rulesyncSubagent.getFrontmatter().opencode as Record<string, unknown>;
      expect(opencode.mode).toBe("all");
      expect(opencode.model).toBe("anthropic/claude-sonnet-4-20250514");
      expect(opencode.temperature).toBe(0.7);
      expect(opencode.topP).toBe(0.9);
      expect(opencode.color).toBe("#FF5733");
      expect(opencode.maxSteps).toBe(10);
    });

    it("should handle agent without registry entry", () => {
      const frontmatter: OpenCodeSubagentFrontmatter = {
        description: "Simple Agent",
      };
      const subagent = new OpenCodeSubagent({
        relativeDirPath: ".opencode/agent",
        relativeFilePath: "simple-agent.md",
        fileContent: "# Simple Agent",
        frontmatter,
        body: "# Simple Agent",
      });

      const rulesyncSubagent = subagent.toRulesyncSubagent();
      expect(rulesyncSubagent.getFrontmatter().name).toBe("simple-agent");
      expect(rulesyncSubagent.getFrontmatter().opencode).toBeUndefined();
    });
  });

  describe("fromRulesyncSubagent", () => {
    it("should convert categorized agent from rulesync to opencode", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test-agent.md",
        frontmatter: {
          targets: ["opencode"],
          name: "test-agent",
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

      const subagent = OpenCodeSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: OpenCodeSubagent.getSettablePaths().relativeDirPath,
        rulesyncSubagent,
      });

      expect(subagent).toBeInstanceOf(OpenCodeSubagent);
      expect(subagent.getRelativeDirPath()).toBe(".opencode/agent");
      expect(subagent.getRelativeFilePath()).toBe("governance/test-agent.md");
      if (subagent instanceof OpenCodeSubagent) {
        expect(subagent.getFrontmatter().description).toBe("Test Agent");

        const fileContent = subagent.getFileContent();
        expect(fileContent).toContain("mode: subagent");
        expect(fileContent).toContain("model: anthropic/claude-sonnet-4-20250514");
        expect(fileContent).toContain("temperature: 0.5");
        expect(fileContent).toContain("# Test Agent");

        expect(subagent.getAgentEntry()).toBeDefined();
        expect(subagent.getAgentEntry()?.slug).toBe("test-agent");
        expect(subagent.getAgentEntry()?.name).toBe("Test Agent");
        expect(subagent.getAgentEntry()?.category).toBe("governance");
        expect(subagent.getAgentEntry()?.capabilities).toEqual(["read", "edit"]);
        expect(subagent.getAgentEntry()?.mcp_servers).toEqual(["context7"]);
      }
    });

    it("should convert root-level agent (empty category) from rulesync to opencode", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "root-agent.md",
        frontmatter: {
          targets: ["opencode"],
          name: "root-agent",
          description: "Root Agent",
          opencode: {
            category: "",
            mode: "primary",
            model: "openrouter/anthropic/claude-3.5-sonnet",
          },
        },
        body: "# Root Agent\n\nRoot level agent content.",
      });

      const subagent = OpenCodeSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: OpenCodeSubagent.getSettablePaths().relativeDirPath,
        rulesyncSubagent,
      });

      expect(subagent.getRelativeFilePath()).toBe("root-agent.md");
      if (subagent instanceof OpenCodeSubagent) {
        expect(subagent.getFrontmatter().description).toBe("Root Agent");

        expect(subagent.getAgentEntry()).toBeDefined();
        expect(subagent.getAgentEntry()?.category).toBeUndefined();
      }
    });

    it("should preserve all frontmatter fields when converting", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "full-agent.md",
        frontmatter: {
          targets: ["opencode"],
          name: "full-agent",
          description: "Full Agent",
          opencode: {
            category: "planning",
            mode: "all",
            model: "anthropic/claude-sonnet-4-20250514",
            temperature: 0.7,
            topP: 0.9,
            color: "#FF5733",
            maxSteps: 10,
          },
        },
        body: "# Full Agent\n\nFull content.",
      });

      const subagent = OpenCodeSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: OpenCodeSubagent.getSettablePaths().relativeDirPath,
        rulesyncSubagent,
      });

      const fileContent = subagent.getFileContent();
      expect(fileContent).toContain("mode: all");
      expect(fileContent).toContain("model: anthropic/claude-sonnet-4-20250514");
      expect(fileContent).toContain("temperature: 0.7");
      expect(fileContent).toContain("topP: 0.9");
      expect(fileContent).toMatch(/color:\s*['"]#FF5733['"]/);
      expect(fileContent).toContain("maxSteps: 10");
    });

    it("should handle missing optional fields when converting", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "minimal-agent.md",
        frontmatter: {
          targets: ["opencode"],
          name: "minimal-agent",
          description: "Minimal Agent",
          opencode: {
            category: "general",
          },
        },
        body: "# Minimal Agent",
      });

      const subagent = OpenCodeSubagent.fromRulesyncSubagent({
        baseDir: testDir,
        relativeDirPath: OpenCodeSubagent.getSettablePaths().relativeDirPath,
        rulesyncSubagent,
      });

      if (subagent instanceof OpenCodeSubagent) {
        expect(subagent.getFrontmatter().description).toBe("Minimal Agent");
        expect(subagent.getAgentEntry()?.category).toBe("general");
      }
    });
  });

  describe("isTargetedByRulesyncSubagent", () => {
    it("should return true for opencode target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["opencode"],
          name: "test",
          description: "Test",
        },
        body: "# Test",
      });

      expect(OpenCodeSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("should return true for wildcard target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["*"],
          name: "test",
          description: "Test",
        },
        body: "# Test",
      });

      expect(OpenCodeSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(true);
    });

    it("should return false for other target", () => {
      const rulesyncSubagent = new RulesyncSubagent({
        relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
        relativeFilePath: "test.md",
        frontmatter: {
          targets: ["claudecode"],
          name: "test",
          description: "Test",
        },
        body: "# Test",
      });

      expect(OpenCodeSubagent.isTargetedByRulesyncSubagent(rulesyncSubagent)).toBe(false);
    });
  });

  describe("validate", () => {
    it("should return success for valid frontmatter", () => {
      const frontmatter: OpenCodeSubagentFrontmatter = {
        description: "Valid agent",
      };
      const subagent = new OpenCodeSubagent({
        relativeDirPath: ".opencode/agent",
        relativeFilePath: "valid.md",
        fileContent: "# Valid",
        frontmatter,
        body: "# Valid",
      });

      const result = subagent.validate();
      expect(result.success).toBe(true);
    });
  });
});
