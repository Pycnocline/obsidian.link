import { App, PluginSettingTab, Setting } from "obsidian";
import type ObsidianLinkPlugin from "./main";

export interface ObsidianLinkSettings {
  hideLinkExtension: boolean;
}

export const DEFAULT_SETTINGS: ObsidianLinkSettings = {
  hideLinkExtension: true
};

export class ObsidianLinkSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ObsidianLinkPlugin) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("在 Notebook Navigator 中隐藏 .link 后缀")
      .setDesc("仅影响 .link 文件列表名称；不修改实际文件名和其他文件的扩展名。")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.hideLinkExtension)
        .onChange(async (value) => {
          await this.plugin.setHideLinkExtension(value);
        }));
    new Setting(this.containerEl)
      .setName("封面图片")
      .setDesc("创建或编辑快捷方式时可选择 Vault 图片。将在 Notebook Navigator 文件列表的快捷方式行显示封面。");
  }
}
