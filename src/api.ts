import type { App, MenuItem, TFile, TFolder } from "obsidian";

export interface CommandEntry {
  id: string;
  name: string;
}

interface CommandsBridge {
  listCommands?: () => CommandEntry[];
  executeCommandById?: (id: string) => boolean;
}

interface ViewRegistryBridge {
  viewByType?: Record<string, unknown> | Map<string, unknown>;
  isViewRegistered?: (type: string) => boolean;
}

export interface NavigatorMenus {
  registerFileMenu?: (callback: (context: {
    file: TFile;
    selection: { mode: string };
    addItem: (callback: (item: MenuItem) => void) => void;
  }) => void) => () => void;
  registerFolderMenu?: (callback: (context: {
    folder: TFolder;
    addItem: (callback: (item: MenuItem) => void) => void;
  }) => void) => () => void;
}

export interface NavigatorBridge {
  menus?: NavigatorMenus;
}

function internalApp(app: App): App & {
  commands?: CommandsBridge;
  viewRegistry?: ViewRegistryBridge;
  plugins?: { plugins?: Record<string, { api?: NavigatorBridge }> };
} {
  return app as ReturnType<typeof internalApp>;
}

export function registeredViewTypes(app: App): string[] {
  const registry = internalApp(app).viewRegistry?.viewByType;
  if (!registry) return [];
  if (registry instanceof Map) return [...registry.keys()];
  return Object.keys(registry);
}

export function viewExists(app: App, type: string): boolean | undefined {
  const registry = internalApp(app).viewRegistry;
  if (typeof registry?.isViewRegistered === "function") {
    return registry.isViewRegistered(type);
  }
  if (registry?.viewByType) {
    return registeredViewTypes(app).includes(type);
  }
  return undefined;
}

export function availableCommands(app: App): CommandEntry[] {
  try {
    const commands = internalApp(app).commands?.listCommands?.();
    if (!Array.isArray(commands)) return [];
    return commands.filter((command) =>
      typeof command?.id === "string" && typeof command?.name === "string");
  } catch {
    return [];
  }
}

export function executeCommand(app: App, id: string): boolean {
  const bridge = internalApp(app).commands;
  if (typeof bridge?.executeCommandById !== "function") {
    throw new Error("当前 Obsidian 版本未提供插件命令执行接口");
  }
  return bridge.executeCommandById(id);
}

export function notebookNavigator(app: App): NavigatorBridge | undefined {
  return internalApp(app).plugins?.plugins?.["notebook-navigator"]?.api;
}
