import { App, FuzzySuggestModal, TFile, TFolder } from "obsidian";
import { validCoverPath } from "./shortcut";

interface FolderOption {
  path: string;
  display: string;
}

export class FolderPickerModal extends FuzzySuggestModal<FolderOption> {
  constructor(app: App, private readonly onPicked: (folder: string) => void) {
    super(app);
    this.setPlaceholder("选择保存目录；可搜索文件夹名称或路径");
    this.emptyStateText = "没有找到文件夹";
    this.limit = 60;
  }

  getItems(): FolderOption[] {
    const folders: FolderOption[] = [{ path: "", display: "Vault 根目录" }];
    for (const file of this.app.vault.getAllLoadedFiles()) {
      if (file instanceof TFolder && file.path !== "/") {
        folders.push({ path: file.path, display: file.path });
      }
    }
    return folders;
  }

  getItemText(folder: FolderOption): string {
    return folder.display;
  }

  onChooseItem(folder: FolderOption): void {
    this.onPicked(folder.path);
  }
}

export class ImagePickerModal extends FuzzySuggestModal<TFile> {
  constructor(app: App, private readonly onPicked: (path: string) => void) {
    super(app);
    this.setPlaceholder("搜索图片名称或路径");
    this.emptyStateText = "Vault 中没有找到图片";
    this.limit = 60;
  }

  getItems(): TFile[] {
    return this.app.vault.getFiles().filter((file) => validCoverPath(file.path));
  }

  getItemText(file: TFile): string {
    return file.path;
  }

  onChooseItem(file: TFile): void {
    this.onPicked(file.path);
  }
}
