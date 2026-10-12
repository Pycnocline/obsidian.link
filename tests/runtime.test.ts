import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const output = await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  platform: "node",
  format: "cjs",
  outfile: "runtime.cjs",
  external: ["obsidian"],
  write: false
});
const runtimeCode = output.outputFiles[0]?.text;
if (!runtimeCode) throw new Error("failed to bundle plugin for runtime tests");

class ElementStub {
  text = "";
  children: ElementStub[] = [];
  empty(): void { this.children = []; this.text = ""; }
  createDiv(options?: { text?: string }): ElementStub {
    const child = new ElementStub();
    child.text = options?.text ?? "";
    this.children.push(child);
    return child;
  }
  createEl(_tag: string, options?: { text?: string }): ElementStub {
    return this.createDiv(options);
  }
  addEventListener(): void {}
  addClass(): void {}
  setText(text: string): void { this.text = text; }
}

class FakeTFile {
  basename: string;
  extension: string;
  parent: FakeTFolder | null = null;
  constructor(public path: string) {
    const filename = path.split("/").at(-1) ?? path;
    this.extension = filename.split(".").at(-1) ?? "";
    this.basename = filename.slice(0, -(this.extension.length + 1));
  }
}
class FakeTFolder {
  constructor(public path: string) {}
}

class FileViewStub {
  file: FakeTFile | null = null;
  app: MockApp;
  contentEl = new ElementStub();
  navigation = true;
  constructor(public leaf: Leaf) { this.app = leaf.app; }
}

class PluginStub {
  views = new Map<string, (leaf: Leaf) => FileViewStub>();
  extensions = new Map<string, string>();
  commands = new Map<string, unknown>();
  manifest = { id: "obsidian-link" };
  constructor(public app: MockApp) {}
  registerView(type: string, creator: (leaf: Leaf) => FileViewStub): void {
    this.views.set(type, creator);
  }
  registerExtensions(extensions: string[], type: string): void {
    extensions.forEach((ext) => this.extensions.set(ext, type));
  }
  addCommand(command: { id: string }): void { this.commands.set(command.id, command); }
  addRibbonIcon(): void {}
  registerEvent(): void {}
  registerInterval(): void {}
}

class ModalStub {
  contentEl = new ElementStub();
  constructor(public app: MockApp) {}
  open(): void {}
  close(): void {}
  setTitle(): void {}
}
class FuzzyModalStub extends ModalStub {
  emptyStateText = "";
  limit = 20;
  setPlaceholder(): void {}
}

class Leaf {
  state: { type: string; state?: Record<string, unknown> } = { type: "obsidian-link-shortcut" };
  view: FileViewStub | null = null;
  detached = false;
  openedFile: FakeTFile | null = null;
  constructor(public app: MockApp) {}
  getViewState(): typeof this.state { return this.state; }
  async setViewState(next: typeof this.state): Promise<void> { this.state = next; }
  async openFile(file: FakeTFile): Promise<void> { this.openedFile = file; }
  detach(): void { this.detached = true; }
}

type MockApp = ReturnType<typeof mockApp>;
function mockApp() {
  const files = new Map<string, FakeTFile>();
  const content = new Map<string, string>();
  const commandsRun: string[] = [];
  const workspace = {
    activeLeaf: null as Leaf | null,
    on(): object { return {}; },
    onLayoutReady(callback: () => void): void { callback(); },
    iterateAllLeaves(callback: (leaf: Leaf) => void): void {
      if (workspace.activeLeaf) callback(workspace.activeLeaf);
    },
    getActiveFile(): FakeTFile | null { return null; },
    getLeavesOfType(): Leaf[] { return []; },
    async revealLeaf(): Promise<void> {},
    getLeaf(): Leaf { return new Leaf(app); }
  };
  const app = {
    workspace,
    viewRegistry: { viewByType: { "wallos-view": true, "markdown": true } },
    commands: {
      listCommands(): Array<{ id: string; name: string }> {
        return [{ id: "wallos:open", name: "Open Wallos" }];
      },
      executeCommandById(id: string): boolean {
        commandsRun.push(id);
        return id === "wallos:open";
      }
    },
    vault: {
      getFiles(): FakeTFile[] { return [...files.values()]; },
      getAbstractFileByPath(path: string): FakeTFile | undefined { return files.get(path); },
      async read(file: FakeTFile): Promise<string> { return content.get(file.path) ?? ""; },
      async create(path: string, text: string): Promise<FakeTFile> {
        const file = new FakeTFile(path);
        files.set(path, file);
        content.set(path, text);
        return file;
      },
      async modify(file: FakeTFile, text: string): Promise<void> {
        content.set(file.path, text);
      },
      async createFolder(): Promise<void> {}
    },
    fileManager: { async renameFile(file: FakeTFile, newPath: string) {
      files.delete(file.path);
      file.path = newPath;
      files.set(newPath, file);
    }},
    plugins: { plugins: {} as Record<string, unknown> },
    files, content, commandsRun
  };
  return app;
}

function loadPlugin(app: MockApp) {
  const timers: Array<() => void> = [];
  const obsidian = {
    Plugin: PluginStub,
    FileView: FileViewStub,
    FuzzySuggestModal: FuzzyModalStub,
    Modal: ModalStub,
    Notice: class {},
    Setting: class {},
    TFile: FakeTFile,
    TFolder: FakeTFolder
  };
  const exports: Record<string, unknown> = {};
  const module = { exports };
  runInNewContext(runtimeCode!, {
    module, exports,
    require: (name: string) => {
      if (name !== "obsidian") throw new Error("unknown module: " + name);
      return obsidian;
    },
    window: {
      setTimeout(callback: () => void): number { timers.push(callback); return 1; },
      setInterval(): number { return 1; },
      clearInterval(): void {}
    },
    console
  });
  const PluginClass = module.exports.default as new (app: MockApp) => PluginStub & {
    onload(): void;
    activateShortcut(target: object, leaf: Leaf, path: string): Promise<void>;
    saveShortcut(name: string, folder: string, target: object, existing: FakeTFile | null): Promise<string>;
  };
  const plugin = new PluginClass(app);
  plugin.onload();
  return { plugin, timers };
}

test("registers .link extension and turns a file open into the plugin view", async () => {
  const app = mockApp();
  const { plugin, timers } = loadPlugin(app);
  assert.equal(plugin.extensions.get("link"), "obsidian-link-shortcut");
  const file = new FakeTFile("应用/Wallos.link");
  app.files.set(file.path, file);
  app.content.set(file.path, JSON.stringify({
    format: "obsidian-link", version: 1,
    target: { kind: "view", viewType: "wallos-view", state: { tab: "overview" } }
  }));
  const leaf = new Leaf(app);
  const view = plugin.views.get("obsidian-link-shortcut")?.(leaf) as FileViewStub & {
    onLoadFile(file: FakeTFile): Promise<void>;
  };
  assert.ok(view);
  leaf.view = view;
  view.file = file;
  await view.onLoadFile(file);
  assert.equal(timers.length, 1);
  timers.shift()?.();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(leaf.state.type, "wallos-view");
  assert.equal(leaf.state.state?.tab, "overview");
});

test("command shortcuts dispatch registered commands", async () => {
  const app = mockApp();
  const { plugin } = loadPlugin(app);
  const leaf = new Leaf(app);
  await plugin.activateShortcut({ kind: "command", commandId: "wallos:open" }, leaf, "Wallos.link");
  assert.deepEqual(app.commandsRun, ["wallos:open"]);
  await assert.rejects(() =>
    plugin.activateShortcut({ kind: "command", commandId: "unknown:command" }, leaf, "none.link"),
    /目标命令不存在/);
});

test("file shortcuts use Obsidian openFile, and invalid view targets report errors", async () => {
  const app = mockApp();
  const { plugin } = loadPlugin(app);
  const leaf = new Leaf(app);
  const file = new FakeTFile("笔记/主页.md");
  app.files.set(file.path, file);
  await plugin.activateShortcut({ kind: "file", path: file.path }, leaf, "Home.link");
  assert.equal(leaf.openedFile, file);
  await assert.rejects(() =>
    plugin.activateShortcut({ kind: "view", viewType: "missing-plugin-view", state: {} }, leaf, "Missing.link"),
    /目标视图未注册/);
});

test("creates portable JSON shortcuts and refuses to overwrite existing files", async () => {
  const app = mockApp();
  const { plugin } = loadPlugin(app);
  const target = { kind: "view", viewType: "wallos-view", state: {} };
  const path = await plugin.saveShortcut("Wallos", "", target, null);
  assert.equal(path, "Wallos.link");
  assert.match(app.content.get(path) ?? "", /"wallos-view"/);
  await assert.rejects(() => plugin.saveShortcut("Wallos", "", target, null), /已有同名文件/);
});
