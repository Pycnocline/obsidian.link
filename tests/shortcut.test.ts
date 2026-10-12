import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cloneJsonRecord, normalizeFilename, normalizeFolder, parseShortcut,
  serializeShortcut, shortcutFilePath, targetDescription
} from "../src/shortcut";

test("view shortcut serializes captured state without mutating input", () => {
  const state = { file: "笔记/测试.md", plugin: { tab: "calendar" } };
  const json = serializeShortcut({ kind: "view", viewType: "wallos-dashboard", state });
  const doc = parseShortcut(json);
  assert.deepEqual(doc.target, { kind: "view", viewType: "wallos-dashboard", state });
  if (doc.target.kind === "view") {
    doc.target.state.file = "another";
    assert.equal(state.file, "笔记/测试.md");
  }
});

test("command and file shortcuts preserve their targets", () => {
  assert.deepEqual(parseShortcut(serializeShortcut({ kind: "command", commandId: "wallos:open" })).target,
    { kind: "command", commandId: "wallos:open" });
  assert.deepEqual(parseShortcut(serializeShortcut({ kind: "file", path: "财务/预算.base" })).target,
    { kind: "file", path: "财务/预算.base" });
});

test("invalid and recursively self-referencing shortcuts are rejected", () => {
  for (const target of [
    { kind: "view", viewType: "obsidian-link-shortcut", state: {} },
    { kind: "view", viewType: "some-view", state: [] },
    { kind: "file", path: "../outside.md" },
    { kind: "file", path: "other.link" },
    { kind: "command", commandId: "" },
    { kind: "wrong" }
  ]) {
    assert.throws(() => parseShortcut(JSON.stringify({ format: "obsidian-link", version: 1, target })));
  }
  assert.throws(() => parseShortcut("{broken"));
  assert.throws(() => parseShortcut(JSON.stringify({ format: "obsidian-link", version: 2, target: {} })));
});

test("portable paths and names are validated", () => {
  assert.equal(shortcutFilePath("生活/应用", "Wallos.link"), "生活/应用/Wallos.link");
  assert.equal(shortcutFilePath("", "日历"), "日历.link");
  assert.equal(normalizeFolder("\\生活\\应用\\"), "生活/应用");
  for (const n of ["", "../bad", "foo:bar", ".", "bad."]) {
    assert.throws(() => normalizeFilename(n));
  }
  for (const n of ["foo/../bar", "foo//bar", "foo/./bar"]) {
    assert.throws(() => normalizeFolder(n));
  }
});

test("JSON state clones are independent", () => {
  const value = { nested: { enabled: true } };
  const copy = cloneJsonRecord(value);
  assert.deepEqual(copy, value);
  (copy.nested as Record<string, unknown>).enabled = false;
  assert.equal(value.nested.enabled, true);
  assert.equal(targetDescription({ kind: "view", viewType: "my-view", state: {} }), "视图：my-view");
});

test("covers are optional, compatible with old .link files and validated", () => {
  const target = { kind: "view" as const, viewType: "wallos-view", state: {} };
  const previous = parseShortcut(serializeShortcut(target));
  assert.equal(previous.cover, undefined);

  const filename = "_assets/Finance/封面.WebP";
  const next = parseShortcut(serializeShortcut(target, filename));
  assert.equal(next.cover, filename);
  assert.deepEqual(next.target, target);

  for (const cover of [
    "https://example.com/cover.jpg",
    "../other.png",
    "image.md",
    "/absolute.jpg",
    "images/bad\\\\path.png",
    ""
  ]) {
    assert.throws(() => parseShortcut(JSON.stringify({
      format: "obsidian-link", version: 1, cover, target
    })));
  }
});
