import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXTENSION_ID, claudeArgs, configDir, install, mcpConfigPath } from "../../../src/install";
import { tempDir } from "../../support/tmp";

describe("install", () => {
  it("writes native manifest, wrapper and MCP config", () => {
    const home = tempDir();
    const r = install({ home, execPath: "/nix/store/x/bin/node", cliPath: "/opt/it's/cli.js" });
    expect(r.manifestPath).toBe(join(home, ".mozilla/native-messaging-hosts/claude_pointer.json"));
    const manifest = JSON.parse(readFileSync(r.manifestPath, "utf8"));
    expect(manifest).toEqual({
      name: "claude_pointer",
      description: "Claude Pointer bridge to Claude Code sessions",
      path: r.wrapperPath,
      type: "stdio",
      allowed_extensions: [EXTENSION_ID],
    });
    expect(manifest.path.startsWith("/")).toBe(true);
    expect(statSync(r.wrapperPath).mode & 0o111).not.toBe(0);
    const wrapper = readFileSync(r.wrapperPath, "utf8");
    expect(wrapper).toContain("exec '/nix/store/x/bin/node' '/opt/it'\\''s/cli.js' native-host");
    const mcp = JSON.parse(readFileSync(r.mcpConfigPath, "utf8"));
    expect(mcp.mcpServers["claude-pointer"]).toEqual({
      command: "/nix/store/x/bin/node",
      args: ["/opt/it's/cli.js", "channel"],
    });
  });

  it("honours XDG config and data homes", () => {
    const home = tempDir();
    const cfg = tempDir();
    const data = tempDir();
    const r = install({ home, configHome: cfg, dataHome: data, execPath: "/n", cliPath: "/c" });
    expect(r.mcpConfigPath).toBe(join(cfg, "claude-pointer/mcp.json"));
    expect(r.wrapperPath).toBe(join(data, "claude-pointer/native-host"));
  });
});

describe("install (feature 002)", () => {
  it("writes the no-channel MCP config and settings.json", () => {
    const home = tempDir();
    const r = install({ home, execPath: "/nix/store/x/bin/node", cliPath: "/opt/cli.js" });
    expect(r.noChannelConfigPath).toBe(join(home, ".config/claude-pointer/mcp-no-channel.json"));
    expect(r.settingsPath).toBe(join(home, ".config/claude-pointer/settings.json"));
    const mcp = JSON.parse(readFileSync(r.noChannelConfigPath, "utf8"));
    expect(mcp.mcpServers["claude-pointer"]).toEqual({
      command: "/nix/store/x/bin/node",
      args: ["/opt/cli.js", "channel", "--no-push"],
    });
    const settings = JSON.parse(readFileSync(r.settingsPath, "utf8"));
    expect(settings.permissions.allow).toContain("mcp__claude-pointer__pick_up_comments");
    expect(settings.permissions.allow).toContain("mcp__claude-pointer__watch_comments");
    expect(settings.permissions.allow).toContain(
      "Bash('/nix/store/x/bin/node' '/opt/cli.js' wait --session *)",
    );
    expect(settings.hooks.UserPromptSubmit[0].hooks[0]).toEqual({
      type: "command",
      command: "'/nix/store/x/bin/node' '/opt/cli.js' notice",
      timeout: 5,
    });
  });
});

describe("claude launcher", () => {
  it("passes the MCP config, settings and development channel flag by default", () => {
    expect(claudeArgs("/h/.config/claude-pointer", ["--model", "opus"])).toEqual([
      "--mcp-config",
      "/h/.config/claude-pointer/mcp.json",
      "--settings",
      "/h/.config/claude-pointer/settings.json",
      "--dangerously-load-development-channels",
      "server:claude-pointer",
      "--model",
      "opus",
    ]);
    expect(mcpConfigPath("/h")).toBe("/h/.config/claude-pointer/mcp.json");
    expect(configDir("/h", "/x")).toBe("/x/claude-pointer");
  });

  it("starts in no-channel mode when --no-channel comes first", () => {
    expect(claudeArgs("/c", ["--no-channel", "-c"])).toEqual([
      "--mcp-config",
      "/c/mcp-no-channel.json",
      "--settings",
      "/c/settings.json",
      "-c",
    ]);
  });

  it("passes --no-channel on when it is not the first argument", () => {
    expect(claudeArgs("/c", ["-c", "--no-channel"]).slice(-2)).toEqual(["-c", "--no-channel"]);
    expect(claudeArgs("/c", ["-c", "--no-channel"])).toContain(
      "--dangerously-load-development-channels",
    );
  });
});

describe("runClaude", () => {
  it("execs claude from PATH with the channel flags and returns its exit code", async () => {
    const { writeFileSync, chmodSync, readFileSync: read } = await import("node:fs");
    const { runClaude } = await import("../../../src/install");
    const bin = tempDir();
    const log = join(bin, "args.txt");
    writeFileSync(join(bin, "claude"), `#!/bin/sh\necho "$@" > ${log}\nexit 3\n`);
    chmodSync(join(bin, "claude"), 0o755);
    const saved = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    };
    process.env.PATH = bin;
    process.env.HOME = "/h";
    delete process.env.XDG_CONFIG_HOME;
    try {
      expect(await runClaude(["-c"])).toBe(3);
      expect(read(log, "utf8").trim()).toBe(
        "--mcp-config /h/.config/claude-pointer/mcp.json --settings /h/.config/claude-pointer/settings.json --dangerously-load-development-channels server:claude-pointer -c",
      );
      process.env.PATH = tempDir();
      expect(await runClaude([])).toBe(127);
    } finally {
      Object.assign(process.env, saved);
    }
  });
});
