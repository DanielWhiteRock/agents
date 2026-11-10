import { describe, it, expect } from "vitest";
import {
  parseHook, parseHooks, decidePreToolUse, sessionStartContext, needsInterception, HookParseError,
} from "../../src/packs/hooks.js";

const hook = (front: string, body = "Not allowed here.") => `---\n${front}\n---\n${body}`;

describe("parseHook", () => {
  it("reads a PreToolUse deny", () => {
    const h = parseHook("hooks/no-rm.md", hook("event: PreToolUse\ntool: bash\nmatch: rm -rf"));
    expect(h).toMatchObject({ event: "PreToolUse", tool: "bash", match: "rm -rf", action: "deny" });
    expect(h.message).toBe("Not allowed here.");
  });
  it("defaults a PreToolUse hook to deny, which is the only useful default", () => {
    expect(parseHook("hooks/h.md", hook("event: PreToolUse")).action).toBe("deny");
  });
  it("defaults a SessionStart hook to inject", () => {
    expect(parseHook("hooks/h.md", hook("event: SessionStart")).action).toBe("inject");
  });
  it("takes the name from the filename when none is given", () => {
    expect(parseHook("hooks/no-secrets.md", hook("event: PreToolUse")).name).toBe("no-secrets");
  });
  it("refuses a hook with no event", () => {
    expect(() => parseHook("hooks/h.md", hook("tool: bash"))).toThrow(/no `event`/);
  });
  it("names the events it does enforce, rather than accepting one it ignores", () => {
    expect(() => parseHook("hooks/h.md", hook("event: PostToolUse")))
      .toThrow(/not enforced yet; this platform supports PreToolUse, SessionStart/);
  });
  it("refuses a hook with no message, since a denial must say why", () => {
    expect(() => parseHook("hooks/h.md", "---\nevent: PreToolUse\n---\n")).toThrow(/needs to say why/);
  });
  it("refuses a SessionStart hook that tries to deny", () => {
    expect(() => parseHook("hooks/h.md", hook("event: SessionStart\naction: deny"))).toThrow(/can only inject/);
  });
  it("refuses an invalid regex at upload rather than at run time", () => {
    expect(() => parseHook("hooks/h.md", hook("event: PreToolUse\nmatch: '[unclosed'")))
      .toThrow(/not a valid regular expression/);
  });
  it("refuses an unknown action", () => {
    expect(() => parseHook("hooks/h.md", hook("event: PreToolUse\naction: explode"))).toThrow(HookParseError);
  });
});

describe("parseHooks", () => {
  it("picks up only files under hooks/, in filename order", () => {
    const hooks = parseHooks([
      { path: "hooks/b.md", content: hook("event: PreToolUse") },
      { path: "hooks/a.md", content: hook("event: SessionStart") },
      { path: "skills/x/SKILL.md", content: "not a hook" },
      { path: "hooks/nested/deep.md", content: hook("event: PreToolUse") },
    ]);
    expect(hooks.map((h) => h.path)).toEqual(["hooks/a.md", "hooks/b.md"]);
  });
});

describe("decidePreToolUse", () => {
  const noRm = parseHook("hooks/no-rm.md", hook("event: PreToolUse\ntool: bash\nmatch: rm -rf", "Deletes are forbidden."));
  const noCurl = parseHook("hooks/no-net.md", hook("event: PreToolUse\ntool: bash\nmatch: curl|wget", "No network from bash."));
  const allowWrite = parseHook("hooks/ok-write.md", hook("event: PreToolUse\ntool: write\naction: allow", "Writing is fine."));

  it("allows a call no hook mentions — hooks restrict, they do not gate", () => {
    expect(decidePreToolUse([noRm], { tool: "read", input: { file_path: "/a" } })).toEqual({ result: "allow" });
  });
  it("denies a matching call and passes the author's reason through", () => {
    expect(decidePreToolUse([noRm], { tool: "bash", input: { command: "rm -rf /tmp/x" } }))
      .toEqual({ result: "deny", reason: "Deletes are forbidden.", hook: "no-rm" });
  });
  it("matches case-insensitively", () => {
    expect(decidePreToolUse([noRm], { tool: "bash", input: { command: "RM -RF /" } }).result).toBe("deny");
  });
  it("leaves the same tool alone when the input does not match", () => {
    expect(decidePreToolUse([noRm], { tool: "bash", input: { command: "ls -la" } }).result).toBe("allow");
  });
  it("applies to every tool when none is named", () => {
    const all = parseHook("hooks/h.md", hook("event: PreToolUse\nmatch: secret", "No secrets."));
    expect(decidePreToolUse([all], { tool: "read", input: { file_path: "/etc/secret" } }).result).toBe("deny");
  });
  it("accepts a comma-separated list of tools", () => {
    const multi = parseHook("hooks/h.md", hook("event: PreToolUse\ntool: write, edit", "Read-only pack."));
    expect(decidePreToolUse([multi], { tool: "edit", input: {} }).result).toBe("deny");
    expect(decidePreToolUse([multi], { tool: "read", input: {} }).result).toBe("allow");
  });
  it("lets a deny win over an allow whatever the file order", () => {
    const deny = parseHook("hooks/z.md", hook("event: PreToolUse\ntool: write\nmatch: .env", "Never touch .env."));
    for (const order of [[allowWrite, deny], [deny, allowWrite]]) {
      expect(decidePreToolUse(order, { tool: "write", input: { file_path: "/app/.env" } }).result).toBe("deny");
    }
  });
  it("reports which hook made the call, so a trace can explain itself", () => {
    expect(decidePreToolUse([noCurl], { tool: "bash", input: { command: "curl example.com" } }).hook).toBe("no-net");
  });
  it("handles a string input as well as an object", () => {
    expect(decidePreToolUse([noRm], { tool: "bash", input: "rm -rf ." }).result).toBe("deny");
  });
  it("survives an input that will not serialise", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;
    expect(() => decidePreToolUse([noRm], { tool: "bash", input: circular })).toThrow();
  });
});

describe("sessionStartContext", () => {
  it("joins every SessionStart message", () => {
    const hooks = [
      parseHook("hooks/a.md", hook("event: SessionStart", "Today is a trading day.")),
      parseHook("hooks/b.md", hook("event: SessionStart", "The client is in Berlin.")),
      parseHook("hooks/c.md", hook("event: PreToolUse", "no")),
    ];
    expect(sessionStartContext(hooks)).toBe("Today is a trading day.\n\nThe client is in Berlin.");
  });
  it("returns nothing when a pack declares none", () => {
    expect(sessionStartContext([])).toBeNull();
  });
});

describe("needsInterception", () => {
  it("is true only when a pack has PreToolUse hooks to enforce", () => {
    expect(needsInterception([parseHook("hooks/a.md", hook("event: PreToolUse"))])).toBe(true);
    expect(needsInterception([parseHook("hooks/a.md", hook("event: SessionStart"))])).toBe(false);
    expect(needsInterception([])).toBe(false);
  });
});

describe("what a match is tested against", () => {
  const anchored = parseHook("hooks/h.md", hook("event: PreToolUse\ntool: bash\nmatch: ^\\s*(ls|find|cat)\\b", "No browsing."));

  it("matches an anchored pattern against the command, not the surrounding JSON", () => {
    // The old behaviour tested `{"command":"ls -la"}`, so `^ls` never matched.
    expect(decidePreToolUse([anchored], { tool: "bash", input: { command: "ls -la /workspace" } }).result).toBe("deny");
  });
  it("still does not match when the command only contains the word later on", () => {
    expect(decidePreToolUse([anchored], { tool: "bash", input: { command: "echo please ls" } }).result).toBe("allow");
  });
  it("looks inside nested values", () => {
    const h = parseHook("hooks/h.md", hook("event: PreToolUse\nmatch: ^secret", "No."));
    expect(decidePreToolUse([h], { tool: "write", input: { file: { path: "secret.env" } } }).result).toBe("deny");
  });
  it("matches a bare string input", () => {
    expect(decidePreToolUse([anchored], { tool: "bash", input: "cat /etc/hosts" }).result).toBe("deny");
  });
  it("still matches an unanchored pattern anywhere in the serialised input", () => {
    const h = parseHook("hooks/h.md", hook("event: PreToolUse\nmatch: /etc/shadow", "No."));
    expect(decidePreToolUse([h], { tool: "read", input: { file_path: "/etc/shadow" } }).result).toBe("deny");
  });
  it("does not recurse for ever on a deeply nested input", () => {
    let deep: Record<string, unknown> = { v: "ls" };
    for (let i = 0; i < 12; i += 1) deep = { nested: deep };
    expect(() => decidePreToolUse([anchored], { tool: "bash", input: deep })).not.toThrow();
  });
});
