import { App, TAbstractFile, TFile } from "obsidian";
import { parseShortcut, SHORTCUT_EXTENSION } from "./shortcut";

interface CoverCacheEntry {
  modified: number;
  result: Promise<string | null>;
}

/**
 * Notebook Navigator exposes menus but not a per-file cover-image setter.
 * Its file rows include data-path and a thumbnail container; decorate only
 * .link rows instead of writing into Notebook Navigator's private cache.
 */
export class NotebookNavigatorAppearance {
  private readonly observers = new Map<Document, MutationObserver>();
  private readonly coverCache = new Map<string, CoverCacheEntry>();
  private readonly scheduled = new Map<Document, number>();
  private stopped = false;
  private hideExtension = true;

  constructor(private readonly app: App) {}

  attach(doc: Document): void {
    if (this.stopped || this.observers.has(doc) || !doc.body) return;
    const Observer = doc.defaultView?.MutationObserver ?? (
      typeof MutationObserver !== "undefined" ? MutationObserver : null
    );
    if (Observer) {
      const observer = new Observer((mutations) => {
        if (mutations.some((mutation) => {
          if (mutation.type !== "childList") return false;
          const target = mutation.target as Element;
          if (target.closest?.(".notebook-navigator")) return true;
          return Array.from(mutation.addedNodes).some((node) => {
            if (node.nodeType !== 1) return false;
            const added = node as Element;
            return added.matches(".notebook-navigator") ||
              added.querySelector(".notebook-navigator") !== null;
          });
        })) this.schedule(doc);
      });
      observer.observe(doc.body, { childList: true, subtree: true });
      this.observers.set(doc, observer);
    }
    doc.body.classList.toggle("obsidian-link-hide-extension", this.hideExtension);
    this.schedule(doc);
  }

  setHideExtension(enabled: boolean): void {
    this.hideExtension = enabled;
    for (const doc of this.observers.keys()) {
      doc.body.classList.toggle("obsidian-link-hide-extension", enabled);
    }
  }

  invalidate(file?: TAbstractFile, previousPath?: string): void {
    if (!file || file instanceof TFile && file.extension.toLowerCase() === SHORTCUT_EXTENSION) {
      if (file) this.coverCache.delete(file.path);
      if (previousPath) this.coverCache.delete(previousPath);
    }
    for (const doc of this.observers.keys()) this.schedule(doc);
  }

  stop(): void {
    this.stopped = true;
    for (const [doc, observer] of this.observers) {
      observer.disconnect();
      doc.body.classList.remove("obsidian-link-hide-extension");
      doc.querySelectorAll(".obsidian-link-owned-thumb").forEach((el) => el.remove());
      doc.querySelectorAll(".obsidian-link-cover-img").forEach((img) => img.remove());
      doc.querySelectorAll(".obsidian-link-has-cover")
        .forEach((el) => el.classList.remove("obsidian-link-has-cover"));
    }
    for (const [doc, timer] of this.scheduled) {
      doc.defaultView?.clearTimeout(timer);
    }
    this.scheduled.clear();
    this.observers.clear();
    this.coverCache.clear();
  }

  private schedule(doc: Document): void {
    if (this.stopped || this.scheduled.has(doc)) return;
    const win = doc.defaultView;
    if (!win) return;
    const timer = win.setTimeout(() => {
      this.scheduled.delete(doc);
      void this.refresh(doc);
    }, 40);
    this.scheduled.set(doc, timer);
  }

  private async getCover(path: string): Promise<string | null> {
    const linkFile = this.app.vault.getAbstractFileByPath(path);
    if (!(linkFile instanceof TFile)) return null;
    const cached = this.coverCache.get(path);
    if (cached && cached.modified === linkFile.stat.mtime) return cached.result;

    const result = this.app.vault.read(linkFile).then(
      (text) => parseShortcut(text).cover ?? null,
      () => null
    ).catch(() => null);
    this.coverCache.set(path, { modified: linkFile.stat.mtime, result });
    return result;
  }

  private async refresh(doc: Document): Promise<void> {
    if (this.stopped) return;
    const rows = doc.querySelectorAll<HTMLElement>(
      '[data-drag-type="file"][data-path$=".link"]'
    );
    await Promise.all(Array.from(rows, async (row) => {
      const path = row.dataset.path;
      if (!path) return;
      const coverPath = await this.getCover(path);
      if (this.stopped || !row.isConnected || row.dataset.path !== path) return;

      const source = coverPath ? this.app.vault.getAbstractFileByPath(coverPath) : null;
      const image = source instanceof TFile ? source : null;
      const key = image ? image.path + ":" + image.stat.mtime : "";
      const src = image ? this.app.vault.getResourcePath(image) : "";

      // Notebook Navigator only creates .nn-file-thumbnail for a small set
      // of formats (and Markdown with a parsed feature image). A .link file
      // never has one, so add a compatible thumbnail slot ourselves.
      let thumbnail = row.querySelector<HTMLElement>(".nn-file-thumbnail");
      if (!src) {
        if (thumbnail?.classList.contains("obsidian-link-owned-thumb")) {
          thumbnail.remove();
        } else if (thumbnail) {
          thumbnail.querySelector(".obsidian-link-cover-img")?.remove();
          thumbnail.classList.remove("obsidian-link-has-cover");
          delete thumbnail.dataset.obsidianLinkCoverFailed;
        }
        return;
      }
      if (!thumbnail) {
        const parent = row.querySelector<HTMLElement>(".nn-file-inner-content");
        if (!parent) return;
        thumbnail = doc.createElement("div");
        thumbnail.className = "nn-file-thumbnail nn-file-thumbnail--square obsidian-link-owned-thumb";
        parent.appendChild(thumbnail);
      }
      if (!thumbnail.isConnected) return;
      const previous = thumbnail.querySelector<HTMLImageElement>(".obsidian-link-cover-img");
      if (previous?.dataset.coverKey === key ||
          thumbnail.dataset.obsidianLinkCoverFailed === key) return;

      previous?.remove();
      const img = doc.createElement("img");
      img.className = "obsidian-link-cover-img";
      img.alt = "";
      img.draggable = false;
      img.dataset.coverKey = key;
      img.addEventListener("error", () => {
        if (img.parentElement !== thumbnail) return;
        thumbnail.dataset.obsidianLinkCoverFailed = key;
        img.remove();
        thumbnail.classList.remove("obsidian-link-has-cover");
      }, { once: true });
      img.src = src;
      thumbnail.classList.add("obsidian-link-has-cover");
      thumbnail.appendChild(img);
    }));
  }
}
