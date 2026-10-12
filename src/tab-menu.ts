import { Menu, Plugin, View, WorkspaceLeaf, Workspace, EventRef } from "obsidian";
import { SHORTCUT_VIEW_TYPE } from "./shortcut";

// Obsidian emits this for tab menus, including plugin views without files.
// This event and View.onTabMenu are not yet in the public type declarations.
type LeafMenuWorkspace = Workspace & {
  on(name: "leaf-menu", callback: (menu: Menu, leaf: WorkspaceLeaf) => void): EventRef;
};
type TabMenuView = View & { onTabMenu?: (menu: Menu) => void };

export class TabShortcutMenu {
  private readonly handled = new WeakSet<Menu>();

  constructor(
    private readonly plugin: Plugin,
    private readonly capture: (leaf: WorkspaceLeaf) => void
  ) {}

  register(): void {
    const workspace = this.plugin.app.workspace as LeafMenuWorkspace;
    this.plugin.registerEvent(workspace.on("leaf-menu", (menu, leaf) => {
      this.add(menu, leaf);
    }));

    // For a background tab the leaf-menu event may not fire. Wrap the
    // core prototype only when the API exists; restore it upon unload.
    const proto = View.prototype as TabMenuView;
    const original = proto.onTabMenu;
    if (typeof original !== "function") return;
    let active = true;
    const self = this;
    const patched = function (this: View, menu: Menu): void {
      original.call(this, menu);
      if (!active) return;
      try {
        self.add(menu, this.leaf);
      } catch (error) {
        console.error("[obsidian-link] 无法扩展标签页菜单", error);
      }
    };
    proto.onTabMenu = patched;
    this.plugin.register(() => {
      active = false;
      if (proto.onTabMenu === patched) proto.onTabMenu = original;
    });
  }

  onFileMenu(menu: Menu, source: string, leaf?: WorkspaceLeaf): boolean {
    if (source !== "tab-header" && source !== "more-options") return false;
    if (leaf) this.add(menu, leaf);
    return true;
  }

  add(menu: Menu, leaf: WorkspaceLeaf | null | undefined): void {
    if (!leaf || this.handled.has(menu)) return;
    const type = leaf.getViewState().type;
    if (!type || type === "empty" || type === SHORTCUT_VIEW_TYPE) return;
    this.handled.add(menu);
    menu.addItem((item) => {
      item.setTitle("将此标签页添加为快捷方式")
        .setIcon("link")
        .onClick(() => this.capture(leaf));
    });
  }
}
