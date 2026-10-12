import {
  App, FuzzySuggestModal, Modal, Notice, Setting, TFile
} from "obsidian";
import type ObsidianLinkPlugin from "./main";
import { FolderPickerModal, ImagePickerModal } from "./path-picker";
import { SHORTCUT_EXTENSION, SHORTCUT_VIEW_TYPE, ShortcutTarget, targetDescription } from "./shortcut";

export interface TargetOption {
  label: string;
  group: string;
  target: ShortcutTarget;
}

type PickerItem =
  | { action: "target"; option: TargetOption }
  | { action: "file"; title: string }
  | { action: "manual"; title: string };

type PickCallback = (option: TargetOption) => void;

export class TargetPickerModal extends FuzzySuggestModal<PickerItem> {
  private readonly items: PickerItem[];
  constructor(
    app: App,
    private readonly plugin: ObsidianLinkPlugin,
    private readonly onPicked: PickCallback
  ) {
    super(app);
    this.setPlaceholder("搜索已打开的界面、插件视图、命令，或选择文件…");
    this.emptyStateText = "没有匹配的界面或命令";
    this.limit = 50;
    this.items = [
      { action: "manual", title: "手动输入视图类型（适用于未打开的插件界面）" },
      { action: "file", title: "从 Vault 选择文件（Markdown / Bases / Canvas / 附件）" },
      ...plugin.discoverTargets().map((option) => ({ action: "target" as const, option }))
    ];
  }

  getItems(): PickerItem[] {
    return this.items;
  }

  getItemText(item: PickerItem): string {
    if (item.action === "manual") return "自定义视图 " + item.title;
    if (item.action === "file") return "文件 " + item.title;
    return item.option.group + " | " + item.option.label + " | " + targetDescription(item.option.target);
  }

  onChooseItem(item: PickerItem): void {
    if (item.action === "file") {
      new FilePickerModal(this.app, this.onPicked).open();
    } else if (item.action === "manual") {
      new ManualViewModal(this.app, this.onPicked).open();
    } else {
      this.onPicked(item.option);
    }
  }
}

class FilePickerModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private readonly onPicked: PickCallback) {
    super(app);
    this.setPlaceholder("搜索 Vault 内的文件路径");
    this.emptyStateText = "找不到文件";
    this.limit = 50;
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((file) =>
      file.extension.toLowerCase() !== SHORTCUT_EXTENSION
    );
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onPicked({
      group: "文件",
      label: file.basename,
      target: { kind: "file", path: file.path }
    });
  }
}

class ManualViewModal extends Modal {
  private type = "";

  constructor(app: App, private readonly onPicked: PickCallback) {
    super(app);
  }

  onOpen(): void {
    this.setTitle("输入 Obsidian 视图类型");
    const text = new Setting(this.contentEl)
      .setName("View type")
      .setDesc("填写已注册插件视图的类型标识；目标插件必须已经启用")
      .addText((input) => {
        input.setPlaceholder("例如 wallos-dashboard");
        input.onChange((value) => { this.type = value.trim(); });
        input.inputEl.focus();
      });
    new Setting(this.contentEl).addButton((button) => button
      .setButtonText("继续")
      .setCta()
      .onClick(() => {
        if (!this.type || this.type === SHORTCUT_VIEW_TYPE || this.type.length > 256) {
          new Notice("视图类型无效");
          return;
        }
        this.close();
        this.onPicked({
          group: "自定义视图",
          label: this.type,
          target: { kind: "view", viewType: this.type, state: {} }
        });
      }));
    void text;
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class ShortcutEditorModal extends Modal {
  private filename: string;
  private folder: string;
  private target: ShortcutTarget;
  private targetLabel: string;
  private errorEl: HTMLElement | null = null;
  private saving = false;
  private cover: string | null;

  constructor(
    app: App,
    private readonly plugin: ObsidianLinkPlugin,
    initial: TargetOption,
    folder: string,
    private readonly existing: TFile | null = null,
    initialCover: string | null = null
  ) {
    super(app);
    this.target = initial.target;
    this.targetLabel = initial.label;
    this.filename = existing?.basename ?? initial.label;
    this.folder = folder;
    this.cover = initialCover;
  }

  onOpen(): void {
    this.renderEditor();
  }

  private renderEditor(): void {
    this.contentEl.empty();
    this.contentEl.addClass("obsidian-link-editor");
    this.setTitle(this.existing ? "编辑界面快捷方式" : "创建界面快捷方式");

    new Setting(this.contentEl).setName("文件名").addText((text) => text
      .setPlaceholder("例如 Wallos")
      .setValue(this.filename)
      .onChange((value) => { this.filename = value; }));

    new Setting(this.contentEl).setName("保存位置").setDesc("从 Vault 中选取文件夹，也可以手动输入新路径")
      .addText((text) => text
        .setPlaceholder("例如 应用/快捷方式")
        .setValue(this.folder)
        .onChange((value) => { this.folder = value; }))
      .addButton((button) => button.setButtonText("选择文件夹").onClick(() => {
        new FolderPickerModal(this.app, (folder) => {
          this.folder = folder;
          this.renderEditor();
        }).open();
      }));

    this.contentEl.createEl("div", {
      cls: "obsidian-link-target",
      text: this.targetLabel + " — " + targetDescription(this.target)
    });

    const cover = new Setting(this.contentEl).setName("封面图片")
      .setDesc(this.cover || "选择 Vault 内的图片，在 Notebook Navigator 缩略图区域显示")
      .addButton((button) => button.setButtonText("选择图片").onClick(() => {
        new ImagePickerModal(this.app, (path) => {
          this.cover = path;
          this.renderEditor();
        }).open();
      }));
    if (this.cover) {
      cover.addButton((button) => button.setButtonText("清除").onClick(() => {
        this.cover = null;
        this.renderEditor();
      }));
      const source = this.app.vault.getAbstractFileByPath(this.cover);
      if (source instanceof TFile) {
        const preview = this.contentEl.createDiv({ cls: "obsidian-link-cover-preview" });
        const image = preview.createEl("img");
        image.src = this.app.vault.getResourcePath(source);
        image.alt = "快捷方式封面预览";
      }
    }

    new Setting(this.contentEl).setName("目标界面").addButton((button) => button
      .setButtonText("重新选择")
      .onClick(() => {
        new TargetPickerModal(this.app, this.plugin, (option) => {
          this.target = option.target;
          this.targetLabel = option.label;
          this.renderEditor();
        }).open();
      }));

    if (this.target.kind === "view") {
      new Setting(this.contentEl)
        .setName("优先复用已打开的同一界面")
        .setDesc("适合侧边栏、单实例插件。目标状态不匹配时仍会新建视图。")
        .addToggle((toggle) => toggle
          .setValue(this.target.kind === "view" && this.target.reuseExisting === true)
          .onChange((enabled) => {
            if (this.target.kind !== "view") return;
            this.target = { ...this.target, reuseExisting: enabled };
          }));
    }

    this.errorEl = this.contentEl.createDiv({ cls: "obsidian-link-error" });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText("取消").onClick(() => this.close()))
      .addButton((button) => button.setButtonText("保存").setCta().onClick(() => {
        void this.save();
      }));
  }

  private async save(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    try {
      const path = await this.plugin.saveShortcut(
        this.filename, this.folder, this.target, this.existing, this.cover
      );
      new Notice("快捷方式已保存：" + path);
      this.close();
    } catch (error) {
      if (this.errorEl) {
        this.errorEl.setText(error instanceof Error ? error.message : String(error));
      }
    } finally {
      this.saving = false;
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
