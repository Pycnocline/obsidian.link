import {
  FuzzySuggestModal, FileView, Menu, Notice, Plugin,
  TAbstractFile, TFile, TFolder, WorkspaceLeaf
} from "obsidian";
import {
  availableCommands, executeCommand, notebookNavigator,
  registeredViewTypes, viewExists
} from "./api";
import { ShortcutEditorModal, TargetOption, TargetPickerModal } from "./dialogs";
import {
  cloneJsonRecord, normalizeFolder, parseShortcut, serializeShortcut,
  shortcutFilePath, SHORTCUT_EXTENSION, SHORTCUT_VIEW_TYPE, ShortcutTarget
} from "./shortcut";

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sourceFolder(file: TAbstractFile | null): string {
  if (!file) return "";
  if (file instanceof TFolder) return file.path === "/" ? "" : file.path;
  return file.parent?.path === "/" ? "" : (file.parent?.path ?? "");
}

class LinkFileView extends FileView {
  private loadToken = 0;
  private lastError: string | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ObsidianLinkPlugin
  ) {
    super(leaf);
    this.navigation = true;
  }

  getViewType(): string {
    return SHORTCUT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "界面快捷方式";
  }

  getIcon(): string {
    return "link";
  }

  async onLoadFile(file: TFile): Promise<void> {
    const token = ++this.loadToken;
    this.lastError = null;
    this.contentEl.empty();
    this.contentEl.createDiv({
      cls: "obsidian-link-fallback",
      text: "正在打开：" + file.basename
    });

    try {
      const shortcut = parseShortcut(await this.app.vault.read(file));
      if (token !== this.loadToken || this.file?.path !== file.path) return;
      // Wait until Obsidian has finished loading this FileView. Setting the
      // target view from within onLoadFile itself can deadlock the leaf.
      window.setTimeout(() => {
        if (token !== this.loadToken || this.leaf.view !== this ||
            this.file?.path !== file.path) return;
        void this.plugin.activateShortcut(shortcut.target, this.leaf, file.path)
          .catch((error: unknown) => {
            if (this.leaf.view === this && token === this.loadToken) {
              this.renderError(file, failureMessage(error));
            } else {
              new Notice("打开快捷方式失败：" + failureMessage(error));
            }
          });
      }, 0);
    } catch (error) {
      if (token === this.loadToken) this.renderError(file, failureMessage(error));
    }
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    this.loadToken += 1;
  }

  private renderError(file: TFile, message: string): void {
    if (this.lastError === message) return;
    this.lastError = message;
    const box = this.contentEl;
    box.empty();
    const content = box.createDiv({ cls: "obsidian-link-fallback" });
    content.createEl("h3", { text: "无法打开快捷方式" });
    content.createEl("p", { text: message });
    const repair = content.createEl("button", { text: "修复快捷方式" });
    repair.addEventListener("click", () => { void this.plugin.editShortcut(file); });
    const retry = content.createEl("button", { text: "重试" });
    retry.addEventListener("click", () => { void this.onLoadFile(file); });
  }
}

class ShortcutOpenModal extends FuzzySuggestModal<TFile> {
  constructor(private readonly plugin: ObsidianLinkPlugin) {
    super(plugin.app);
    this.setPlaceholder("搜索快捷方式");
    this.emptyStateText = "Vault 内没有 .link 文件";
  }

  getItems(): TFile[] {
    return this.plugin.app.vault.getFiles().filter((file) =>
      file.extension.toLowerCase() === SHORTCUT_EXTENSION
    );
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    void this.plugin.app.workspace.getLeaf(false).openFile(file)
      .catch((error: unknown) => new Notice(failureMessage(error)));
  }
}

export default class ObsidianLinkPlugin extends Plugin {
  private navigatorMenus: object | null = null;
  private navigatorDisposers: Array<() => void> = [];

  onload(): void {
    this.registerView(SHORTCUT_VIEW_TYPE, (leaf) => new LinkFileView(leaf, this));
    this.registerExtensions([SHORTCUT_EXTENSION], SHORTCUT_VIEW_TYPE);

    this.addCommand({
      id: "create-shortcut",
      name: "创建界面快捷方式",
      callback: () => this.pickTarget()
    });
    this.addCommand({
      id: "capture-current-view",
      name: "为当前界面创建快捷方式",
      callback: () => this.captureCurrentView()
    });
    this.addCommand({
      id: "open-shortcut",
      name: "选择并打开快捷方式",
      callback: () => new ShortcutOpenModal(this).open()
    });

    this.addRibbonIcon("link", "创建界面快捷方式", () => this.pickTarget());

    this.registerEvent(this.app.workspace.on("file-menu", (menu, file) => {
      this.addNativeFileMenu(menu, file);
    }));
    this.registerEvent(this.app.workspace.on("layout-change", () => {
      this.tryRegisterNavigatorMenus();
    }));
    this.app.workspace.onLayoutReady(() => this.tryRegisterNavigatorMenus());

    // Some plugins load their API after layout-ready. Poll only during startup;
    // layout-change handles subsequent plugin enable/disable events.
    let attempts = 0;
    const interval = window.setInterval(() => {
      if (this.tryRegisterNavigatorMenus() || ++attempts >= 12) {
        window.clearInterval(interval);
      }
    }, 2500);
    this.registerInterval(interval);
  }

  onunload(): void {
    this.clearNavigatorMenus();
  }

  private clearNavigatorMenus(): void {
    for (const dispose of this.navigatorDisposers.splice(0)) {
      try { dispose(); } catch { /* Notebook Navigator may be unloading. */ }
    }
    this.navigatorMenus = null;
  }

  private tryRegisterNavigatorMenus(): boolean {
    const menus = notebookNavigator(this.app)?.menus;
    if (!menus) return false;
    if (menus === this.navigatorMenus) return true;
    this.clearNavigatorMenus();

    if (typeof menus.registerFileMenu === "function") {
      this.navigatorDisposers.push(menus.registerFileMenu(({ file, selection, addItem }) => {
        if (selection.mode !== "single") return;
        if (file.extension.toLowerCase() === SHORTCUT_EXTENSION) {
          addItem((item) => item.setTitle("编辑界面快捷方式").setIcon("pencil")
            .onClick(() => { void this.editShortcut(file); }));
        } else {
          addItem((item) => item.setTitle("为此文件创建界面快捷方式").setIcon("link")
            .onClick(() => this.createFromFile(file)));
        }
        addItem((item) => item.setTitle("在此文件夹创建界面快捷方式").setIcon("link-2")
          .onClick(() => this.pickTarget(sourceFolder(file))));
      }));
    }

    if (typeof menus.registerFolderMenu === "function") {
      this.navigatorDisposers.push(menus.registerFolderMenu(({ folder, addItem }) => {
        addItem((item) => item.setTitle("在此文件夹创建界面快捷方式").setIcon("link")
          .onClick(() => this.pickTarget(sourceFolder(folder))));
      }));
    }

    this.navigatorMenus = menus;
    return true;
  }

  private addNativeFileMenu(menu: Menu, file: TAbstractFile): void {
    if (file instanceof TFolder) {
      menu.addItem((item) => item.setTitle("在此文件夹创建界面快捷方式").setIcon("link")
        .onClick(() => this.pickTarget(sourceFolder(file))));
      return;
    }
    if (!(file instanceof TFile)) return;
    if (file.extension.toLowerCase() === SHORTCUT_EXTENSION) {
      menu.addItem((item) => item.setTitle("编辑界面快捷方式").setIcon("pencil")
        .onClick(() => { void this.editShortcut(file); }));
      return;
    }
    menu.addItem((item) => item.setTitle("为此文件创建界面快捷方式").setIcon("link")
      .onClick(() => this.createFromFile(file)));
    menu.addItem((item) => item.setTitle("在此文件夹创建界面快捷方式").setIcon("link-2")
      .onClick(() => this.pickTarget(sourceFolder(file))));
  }

  private pickTarget(folder?: string): void {
    const destination = folder ?? sourceFolder(this.app.workspace.getActiveFile());
    new TargetPickerModal(this.app, this, (option) => {
      new ShortcutEditorModal(this.app, this, option, destination).open();
    }).open();
  }

  private createFromFile(file: TFile): void {
    const option: TargetOption = {
      group: "文件",
      label: file.basename,
      target: { kind: "file", path: file.path }
    };
    new ShortcutEditorModal(this.app, this, option, sourceFolder(file)).open();
  }

  private captureCurrentView(): void {
    const leaf = this.app.workspace.activeLeaf;
    if (!leaf) {
      new Notice("当前没有可保存的界面");
      return;
    }
    const view = leaf.getViewState();
    if (!view.type || view.type === "empty" || view.type === SHORTCUT_VIEW_TYPE) {
      new Notice("当前界面不能作为快捷方式目标");
      return;
    }
    try {
      const target: ShortcutTarget = {
        kind: "view", viewType: view.type, state: cloneJsonRecord(view.state)
      };
      const label = leaf.view.getDisplayText() || view.type;
      const option: TargetOption = { group: "当前界面", label, target };
      new ShortcutEditorModal(this.app, this, option,
        sourceFolder(this.app.workspace.getActiveFile())).open();
    } catch (error) {
      new Notice("无法记录当前界面：" + failureMessage(error));
    }
  }

  discoverTargets(): TargetOption[] {
    const results: TargetOption[] = [];
    const openTypes = new Set<string>();

    this.app.workspace.iterateAllLeaves((leaf) => {
      try {
        const snapshot = leaf.getViewState();
        if (!snapshot.type || snapshot.type === "empty" ||
            snapshot.type === SHORTCUT_VIEW_TYPE) return;
        const state = cloneJsonRecord(snapshot.state);
        const label = leaf.view.getDisplayText() || snapshot.type;
        results.push({
          group: "已打开的界面",
          label,
          target: { kind: "view", viewType: snapshot.type, state }
        });
        openTypes.add(snapshot.type);
      } catch {
        // A third-party view may return a non-serializable state.
      }
    });

    for (const type of registeredViewTypes(this.app).sort()) {
      if (!type || type === "empty" || type === SHORTCUT_VIEW_TYPE) continue;
      results.push({
        group: openTypes.has(type) ? "已注册的视图类型" : "插件 / 核心视图类型",
        label: type,
        target: { kind: "view", viewType: type, state: {} }
      });
    }

    for (const command of availableCommands(this.app)) {
      if (command.id.startsWith(this.manifest.id + ":")) continue;
      results.push({
        group: "插件 / 核心命令",
        label: command.name,
        target: { kind: "command", commandId: command.id }
      });
    }
    return results;
  }

  async editShortcut(file: TFile): Promise<void> {
    let target: ShortcutTarget;
    try {
      target = parseShortcut(await this.app.vault.read(file)).target;
    } catch (error) {
      new Notice("原快捷方式需要修复：" + failureMessage(error));
      this.pickRepairTarget(file);
      return;
    }
    const option: TargetOption = {
      group: "现有快捷方式", label: file.basename, target
    };
    new ShortcutEditorModal(this.app, this, option, sourceFolder(file), file).open();
  }

  private pickRepairTarget(file: TFile): void {
    new TargetPickerModal(this.app, this, (option) => {
      new ShortcutEditorModal(this.app, this, option, sourceFolder(file), file).open();
    }).open();
  }

  private async ensureFolder(folder: string): Promise<void> {
    if (!folder) return;
    const segments = folder.split("/");
    let path = "";
    for (const segment of segments) {
      path = path ? path + "/" + segment : segment;
      const current = this.app.vault.getAbstractFileByPath(path);
      if (current instanceof TFolder) continue;
      if (current) throw new Error("目标路径不是文件夹：" + path);
      try {
        await this.app.vault.createFolder(path);
      } catch (error) {
        if (!(this.app.vault.getAbstractFileByPath(path) instanceof TFolder)) throw error;
      }
    }
  }

  async saveShortcut(
    filename: string, folderInput: string, target: ShortcutTarget, existing: TFile | null
  ): Promise<string> {
    const folder = normalizeFolder(folderInput);
    const path = shortcutFilePath(folder, filename);
    const data = serializeShortcut(target);
    const occupying = this.app.vault.getAbstractFileByPath(path);
    if (occupying && occupying !== existing) {
      throw new Error("已有同名文件：" + path);
    }
    await this.ensureFolder(folder);
    if (existing) {
      if (existing.path !== path) await this.app.fileManager.renameFile(existing, path);
      await this.app.vault.modify(existing, data);
    } else {
      await this.app.vault.create(path, data);
    }
    return path;
  }

  async activateShortcut(
    target: ShortcutTarget, sourceLeaf: WorkspaceLeaf, sourceFilePath: string
  ): Promise<void> {
    const workspace = this.app.workspace;
    if (target.kind === "file") {
      const file = this.app.vault.getAbstractFileByPath(target.path);
      if (!(file instanceof TFile)) throw new Error("目标文件不存在：" + target.path);
      await sourceLeaf.openFile(file);
      return;
    }

    if (target.kind === "view") {
      if (target.reuseExisting) {
        const existing = workspace.getLeavesOfType(target.viewType).find((leaf) => {
          if (leaf === sourceLeaf) return false;
          if (!Object.keys(target.state).length) return true;
          try {
            const current = cloneJsonRecord(leaf.getViewState().state);
            return JSON.stringify(current) === JSON.stringify(target.state);
          } catch {
            return false;
          }
        });
        if (existing) {
          await workspace.revealLeaf(existing);
          this.closeShortcutLeaf(sourceLeaf, sourceFilePath);
          return;
        }
      }

      if (viewExists(this.app, target.viewType) === false) {
        throw new Error("目标视图未注册：" + target.viewType +
          "。请确认对应插件已启用，或改用该插件的打开命令。");
      }
      await sourceLeaf.setViewState({
        type: target.viewType,
        state: cloneJsonRecord(target.state),
        active: true
      });
      if (sourceLeaf.getViewState().type !== target.viewType) {
        throw new Error("目标插件没有正确加载视图：" + target.viewType);
      }
      await workspace.revealLeaf(sourceLeaf);
      return;
    }

    const commands = availableCommands(this.app);
    if (commands.length && !commands.some((command) => command.id === target.commandId)) {
      throw new Error("目标命令不存在：" + target.commandId);
    }
    if (!executeCommand(this.app, target.commandId)) {
      throw new Error("目标命令无法执行：" + target.commandId);
    }
    // Commands own their activation and may create a sidebar, tab, or modal.
    // Remove the temporary shortcut tab only if the command did not replace it.
    window.setTimeout(() => this.closeShortcutLeaf(sourceLeaf, sourceFilePath), 250);
  }

  private closeShortcutLeaf(leaf: WorkspaceLeaf, sourceFilePath: string): void {
    if (leaf.getViewState().type !== SHORTCUT_VIEW_TYPE) return;
    const view = leaf.view;
    if (view instanceof LinkFileView && view.file?.path === sourceFilePath) {
      leaf.detach();
    }
  }
}
