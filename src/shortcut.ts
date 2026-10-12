export const SHORTCUT_EXTENSION = "link";
export const SHORTCUT_FORMAT = "obsidian-link";
export const SHORTCUT_VERSION = 1;
export const SHORTCUT_VIEW_TYPE = "obsidian-link-shortcut";
export const MAX_SHORTCUT_BYTES = 128 * 1024;

export type JsonRecord = Record<string, unknown>;

export type ShortcutTarget =
  | { kind: "view"; viewType: string; state: JsonRecord; reuseExisting?: boolean }
  | { kind: "command"; commandId: string }
  | { kind: "file"; path: string };

export interface ShortcutDocument {
  format: typeof SHORTCUT_FORMAT;
  version: typeof SHORTCUT_VERSION;
  target: ShortcutTarget;
  cover?: string;
}

export function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function cloneJsonRecord(value: unknown): JsonRecord {
  if (!isRecord(value)) return {};
  const copy: unknown = JSON.parse(JSON.stringify(value));
  if (!isRecord(copy)) throw new Error("无法保存此界面的状态");
  return copy;
}

export function validVaultPath(path: string): boolean {
  return path.length > 0 &&
    !path.startsWith("/") &&
    !path.includes("\\") &&
    !path.split("/").some((part) => part === "" || part === "." || part === "..") &&
    !/[\u0000-\u001f]/.test(path);
}

export const COVER_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "avif", "heic", "heif"
]);

export function validCoverPath(path: string): boolean {
  const extension = path.split(".").pop()?.toLowerCase();
  return validVaultPath(path) && extension !== undefined && COVER_EXTENSIONS.has(extension);
}

export function normalizeFolder(folder: string): string {
  const normalized = folder.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) return "";
  if (!validVaultPath(normalized)) throw new Error("文件夹路径不合法");
  return normalized;
}

export function normalizeFilename(name: string): string {
  const trimmed = name.trim().replace(/\.link$/i, "").trim();
  if (!trimmed || trimmed === "." || trimmed === ".." ||
      /[\\/:*?"<>|\u0000-\u001f]/.test(trimmed) || /[. ]$/.test(trimmed)) {
    throw new Error("文件名不能为空，且不能包含路径分隔符或系统保留字符");
  }
  return trimmed;
}

export function shortcutFilePath(folder: string, filename: string): string {
  const f = normalizeFolder(folder);
  const name = normalizeFilename(filename);
  return (f ? f + "/" : "") + name + "." + SHORTCUT_EXTENSION;
}

export function parseShortcut(raw: string): ShortcutDocument {
  if (raw.length > MAX_SHORTCUT_BYTES) throw new Error("快捷方式文件过大");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("快捷方式文件不是有效的 JSON");
  }
  if (!isRecord(parsed) || parsed.format !== SHORTCUT_FORMAT || parsed.version !== SHORTCUT_VERSION) {
    throw new Error("不支持的快捷方式文件格式或版本");
  }
  const cover = parsed.cover;
  if (cover !== undefined && (typeof cover !== "string" || !validCoverPath(cover))) {
    throw new Error("封面必须指向 Vault 中支持的图片文件");
  }
  const withCover = cover === undefined ? {} : { cover };
  const target = parsed.target;
  if (!isRecord(target)) throw new Error("快捷方式缺少目标");
  if (target.kind === "view") {
    if (typeof target.viewType !== "string" || !target.viewType.trim() ||
        target.viewType === SHORTCUT_VIEW_TYPE || target.viewType.length > 256) {
      throw new Error("无效的视图类型");
    }
    if (target.state !== undefined && !isRecord(target.state)) {
      throw new Error("视图状态必须是对象");
    }
    if (target.reuseExisting !== undefined && typeof target.reuseExisting !== "boolean") {
      throw new Error("无效的视图复用选项");
    }
    return {
      format: SHORTCUT_FORMAT,
      version: SHORTCUT_VERSION,
      ...withCover,
      target: {
        kind: "view",
        viewType: target.viewType,
        state: cloneJsonRecord(target.state),
        ...(target.reuseExisting === true ? { reuseExisting: true } : {})
      }
    };
  }
  if (target.kind === "command") {
    if (typeof target.commandId !== "string" || !target.commandId.trim() || target.commandId.length > 256) {
      throw new Error("无效的命令 ID");
    }
    return {
      format: SHORTCUT_FORMAT,
      version: SHORTCUT_VERSION,
      ...withCover,
      target: { kind: "command", commandId: target.commandId }
    };
  }
  if (target.kind === "file") {
    if (typeof target.path !== "string" || !validVaultPath(target.path) ||
        target.path.toLowerCase().endsWith(".link")) {
      throw new Error("目标文件路径无效或指向另一个快捷方式");
    }
    return {
      format: SHORTCUT_FORMAT,
      version: SHORTCUT_VERSION,
      ...withCover,
      target: { kind: "file", path: target.path }
    };
  }
  throw new Error("未知的快捷方式目标类型");
}

export function serializeShortcut(target: ShortcutTarget, cover?: string): string {
  const raw = JSON.stringify({ format: SHORTCUT_FORMAT, version: SHORTCUT_VERSION, target, ...(cover ? { cover } : {}) }, null, 2) + "\n";
  parseShortcut(raw);
  return raw;
}

export function targetDescription(target: ShortcutTarget): string {
  switch (target.kind) {
    case "view": return "视图：" + target.viewType + (target.reuseExisting ? "（优先复用）" : "");
    case "command": return "命令：" + target.commandId;
    case "file": return "文件：" + target.path;
  }
}
