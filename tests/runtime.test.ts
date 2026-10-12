import { test } from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { Window } from "happy-dom";

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
  stat = { mtime: 1, size: 100 };
  constructor(public path: string) {
    const filename = path.split("/").at(-1) ?? path;
    this.extension = filename.split(".").at(-1) ?? "";
    this.basename = filename.slice(0, -(this.extension.length + 1));
  }
}
class FakeTFolder {
  constructor(public path: string) {}
}

class ViewStub {
  leaf: Leaf | null = null;
  onTabMenu(_menu: unknown): void {}
  getDisplayText(): string { return "测试界面"; }
}

class FileViewStub extends ViewStub {
  file: FakeTFile | null = null;
  app: MockApp;
  contentEl = new ElementStub();
  navigation = true;
  constructor(leaf: Leaf) { super(); this.leaf = leaf; this.app = leaf.app; }
}

class PluginStub {
  views = new Map<string, (leaf: Leaf) => FileViewStub>();
  extensions = new Map<string, string>();
  commands = new Map<string, unknown>();
  manifest = { id: "obsidian-link" };
  constructor(public app: MockApp) {}
  async loadData(): Promise<object> { return {}; }
  async saveData(_data: unknown): Promise<void> {}
  addSettingTab(): void {}
  cleanups: Array<() => void> = [];
  register(dispose: () => void): void { this.cleanups.push(dispose); }
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
class PluginSettingTabStub extends ModalStub {}
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

class FakeMenuItem {
  title = "";
  action: () => void = () => {};
  setTitle(title: string): this { this.title = title; return this; }
  setIcon(_icon: string): this { return this; }
  onClick(callback: () => void): this { this.action = callback; return this; }
}
class FakeMenu {
  items: FakeMenuItem[] = [];
  addItem(callback: (item: FakeMenuItem) => void): this {
    const item = new FakeMenuItem();
    callback(item);
    this.items.push(item);
    return this;
  }
  titles(): string[] { return this.items.map((item) => item.title); }
}

function mockApp() {
  const events = new Map<string, Array<(...args: any[]) => void>>();
  const files = new Map<string, FakeTFile>();
  const content = new Map<string, string>();
  const commandsRun: string[] = [];
  const workspace = {
    activeLeaf: null as Leaf | null,
    on(event: string, listener: (...args: any[]) => void): object {
      const bucket = events.get(event) ?? [];
      bucket.push(listener);
      events.set(event, bucket);
      return {};
    },
    emit(event: string, ...args: unknown[]): void {
      for (const handler of events.get(event) ?? []) handler(...args);
    },
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
      on(): object { return {}; },
      getAllLoadedFiles(): FakeTFile[] { return [...files.values()]; },
      getResourcePath(file: FakeTFile): string { return "app://vault/" + file.path; },
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
    files, content, commandsRun, events
  };
  return app;
}

async function loadPlugin(app: MockApp, documentForTest?: Document) {
  const timers: Array<() => void> = [];
  const obsidian = {
    Plugin: PluginStub,
    FileView: FileViewStub,
    FuzzySuggestModal: FuzzyModalStub,
    Modal: ModalStub,
    Notice: class {},
    Setting: class {},
    PluginSettingTab: PluginSettingTabStub,
    View: ViewStub,
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
    document: documentForTest,
    window: {
      setTimeout(callback: () => void): number { timers.push(callback); return 1; },
      setInterval(): number { return 1; },
      clearInterval(): void {}
    },
    console
  });
  const PluginClass = module.exports.default as new (app: MockApp) => PluginStub & {
    onload(): Promise<void>;
    onunload(): void;
    settings: {hideLinkExtension: boolean};
    setHideLinkExtension(enabled: boolean): Promise<void>;
    activateShortcut(target: object, leaf: Leaf, path: string): Promise<void>;
    saveShortcut(name: string, folder: string, target: object, existing: FakeTFile | null, cover?: string | null): Promise<string>;
  };
  const plugin = new PluginClass(app);
  await plugin.onload();
  return { plugin, timers };
}

function cleanupPlugin(plugin: PluginStub & { onunload(): void }): void {
  plugin.cleanups.forEach((cleanup) => cleanup());
  plugin.onunload();
}

test("registers .link extension and turns a file open into the plugin view", async () => {
  const app = mockApp();
  const { plugin, timers } = await loadPlugin(app);
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
  cleanupPlugin(plugin);
});

test("command shortcuts dispatch registered commands", async () => {
  const app = mockApp();
  const { plugin } = await loadPlugin(app);
  const leaf = new Leaf(app);
  await plugin.activateShortcut({ kind: "command", commandId: "wallos:open" }, leaf, "Wallos.link");
  assert.deepEqual(app.commandsRun, ["wallos:open"]);
  await assert.rejects(() =>
    plugin.activateShortcut({ kind: "command", commandId: "unknown:command" }, leaf, "none.link"),
    /目标命令不存在/);
  cleanupPlugin(plugin);
});

test("file shortcuts use Obsidian openFile, and invalid view targets report errors", async () => {
  const app = mockApp();
  const { plugin } = await loadPlugin(app);
  const leaf = new Leaf(app);
  const file = new FakeTFile("笔记/主页.md");
  app.files.set(file.path, file);
  await plugin.activateShortcut({ kind: "file", path: file.path }, leaf, "Home.link");
  assert.equal(leaf.openedFile, file);
  await assert.rejects(() =>
    plugin.activateShortcut({ kind: "view", viewType: "missing-plugin-view", state: {} }, leaf, "Missing.link"),
    /目标视图未注册/);
  cleanupPlugin(plugin);
});

test("creates portable JSON shortcuts and refuses to overwrite existing files", async () => {
  const app = mockApp();
  const { plugin } = await loadPlugin(app);
  const target = { kind: "view", viewType: "wallos-view", state: {} };
  const path = await plugin.saveShortcut("Wallos", "", target, null);
  assert.equal(path, "Wallos.link");
  assert.match(app.content.get(path) ?? "", /"wallos-view"/);
  await assert.rejects(() => plugin.saveShortcut("Wallos", "", target, null), /已有同名文件/);
  cleanupPlugin(plugin);
});

test("tab and more-options menus capture the clicked leaf, not the active leaf", async () => {
  const app = mockApp();
  const { plugin } = await loadPlugin(app);
  const captured: Leaf[] = [];
  (plugin as unknown as { captureLeafView: (leaf: Leaf) => void }).captureLeafView =
    (leaf) => { captured.push(leaf); };

  const active = new Leaf(app);
  active.state = { type: "markdown", state: { file: "活跃.md" } };
  app.workspace.activeLeaf = active;
  const selected = new Leaf(app);
  selected.state = { type: "wallos-view", state: { tab: "calendar" } };
  const selectedFile = new FakeTFile("财务/Wallos.md");
  selected.view = new FileViewStub(selected);
  selected.view.file = selectedFile;

  const tabMenu = new FakeMenu();
  app.workspace.emit("file-menu", tabMenu, selectedFile, "tab-header", selected);
  app.workspace.emit("leaf-menu", tabMenu, selected);
  assert.equal(tabMenu.titles().filter((title) => title.includes("此标签页")).length, 1);
  tabMenu.items[0]?.action();
  assert.equal(captured[0], selected);

  const moreMenu = new FakeMenu();
  app.workspace.emit("file-menu", moreMenu, selectedFile, "more-options", selected);
  assert.deepEqual(moreMenu.titles(), ["将此标签页添加为快捷方式"]);
  moreMenu.items[0]?.action();
  assert.equal(captured[1], selected);

  const explorerMenu = new FakeMenu();
  app.workspace.emit("file-menu", explorerMenu, selectedFile, "file-explorer", undefined);
  assert.ok(explorerMenu.titles().some((title) => title.includes("为此文件")));
  assert.ok(!explorerMenu.titles().some((title) => title.includes("此标签页")));
  cleanupPlugin(plugin);
});

test("plugin-only tabs and background tabs provide shortcut menu items", async () => {
  const app = mockApp();
  const { plugin } = await loadPlugin(app);
  const captured: Leaf[] = [];
  (plugin as unknown as { captureLeafView: (leaf: Leaf) => void }).captureLeafView =
    (leaf) => { captured.push(leaf); };
  const leaf = new Leaf(app);
  leaf.state = { type: "plugin-special-dashboard", state: { section: "summary" } };
  leaf.view = new FileViewStub(leaf);
  const menu = new FakeMenu();
  app.workspace.emit("leaf-menu", menu, leaf);
  assert.deepEqual(menu.titles(), ["将此标签页添加为快捷方式"]);
  menu.items[0]?.action();

  const hiddenTabMenu = new FakeMenu();
  leaf.view.onTabMenu(hiddenTabMenu);
  assert.deepEqual(hiddenTabMenu.titles(), ["将此标签页添加为快捷方式"]);
  hiddenTabMenu.items[0]?.action();
  assert.deepEqual(captured, [leaf, leaf]);
  cleanupPlugin(plugin);
});

test("shortcut cover is saved, and nonexistent images are refused", async () => {
  const app = mockApp();
  const { plugin } = await loadPlugin(app);
  const image = new FakeTFile("_assets/壁纸.png");
  app.files.set(image.path, image);
  const target = { kind: "view", viewType: "wallos-view", state: {} };
  await plugin.saveShortcut("Wallos", "", target, null, image.path);
  assert.match(app.content.get("Wallos.link") ?? "", /"cover": "_assets\/壁纸.png"/);
  await assert.rejects(() =>
    plugin.saveShortcut("Bad", "", target, null, "missing.png"),
    /封面图片不存在/);
  cleanupPlugin(plugin);
});

test("Notebook Navigator .link cover is rendered without its own thumbnail slot", async () => {
  const win = new Window({ url: "https://example.test/" });
  const doc = win.document as unknown as Document;
  const app = mockApp();
  const image = new FakeTFile("_assets/封面.png");
  const link = new FakeTFile("Dashboard.link");
  app.files.set(image.path, image);
  app.files.set(link.path, link);
  app.content.set(link.path, JSON.stringify({
    format: "obsidian-link", version: 1,
    cover: image.path,
    target: { kind: "view", viewType: "wallos-view", state: {} }
  }));

  const row = doc.createElement("div");
  row.setAttribute("data-drag-type", "file");
  row.setAttribute("data-path", link.path);
  row.className = "nn-file";
  row.innerHTML = '<div class="nn-file-inner-content"><span class="nn-file-name">Dashboard<span class="nn-file-ext-suffix">.link</span></span></div>';
  const navigator = doc.createElement("div");
  navigator.className = "notebook-navigator";
  navigator.appendChild(row);
  doc.body.appendChild(navigator);

  const { plugin } = await loadPlugin(app, doc);
  await new Promise((resolve) => setTimeout(resolve, 130));
  const thumb = row.querySelector(".obsidian-link-owned-thumb");
  assert.ok(thumb, "must create a thumbnail for .link: Notebook Navigator provides none");
  assert.equal(thumb.querySelector("img")?.getAttribute("src"), "app://vault/_assets/封面.png");
  assert.ok(doc.body.classList.contains("obsidian-link-hide-extension"));

  // React's virtualized list adds rows after startup.
  const secondRow = doc.createElement("div");
  secondRow.setAttribute("data-drag-type", "file");
  secondRow.setAttribute("data-path", link.path);
  secondRow.innerHTML = '<div class="nn-file-inner-content"><span class="nn-file-name">Dashboard</span></div>';
  navigator.appendChild(secondRow);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(secondRow.querySelector(".obsidian-link-cover-img"));

  await plugin.setHideLinkExtension(false);
  assert.equal(doc.body.classList.contains("obsidian-link-hide-extension"), false);

  // A saved edit removes an obsolete cover without requiring a full restart.
  link.stat.mtime += 1;
  app.content.set(link.path, JSON.stringify({
    format: "obsidian-link", version: 1,
    target: { kind: "view", viewType: "wallos-view", state: {} }
  }));
  await plugin.saveShortcut("Dashboard", "", { kind: "view", viewType: "wallos-view", state: {} }, link);
  await new Promise((resolve) => setTimeout(resolve, 130));
  assert.equal(row.querySelector(".obsidian-link-owned-thumb"), null);
  assert.equal(secondRow.querySelector(".obsidian-link-owned-thumb"), null);
  cleanupPlugin(plugin);
  await win.happyDOM.close();
});
