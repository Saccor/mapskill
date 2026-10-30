import type { Stats } from 'node:fs';
import path from 'node:path';
import { createIgnoredDirFilter, isSkippedDir } from '@mapskill/core';
import { watch } from 'chokidar';

export interface WatchEvent {
  /** Project-relative path with '/' separators. */
  rel: string;
  kind: 'file' | 'dir-removed';
}

export interface ProjectWatcher {
  close(): Promise<void>;
}

/** Watches the project for added, changed and removed files. Resolves once the initial crawl is done. */
export async function watchProject(
  root: string,
  onEvent: (e: WatchEvent) => void,
  onError: (err: unknown) => void = () => {},
): Promise<ProjectWatcher> {
  const toRel = (abs: string): string => path.relative(root, abs).split(path.sep).join('/');
  // Skipped folders and folders the .gitignore excludes (read once; the daemon restarts the watcher when it changes).
  // Files are never ignored by .gitignore alone: applyFileChanges filters them anyway.
  const ignoredDir = createIgnoredDirFilter(root);
  const watcher = watch(root, {
    ignoreInitial: true,
    // The scan skips symlinks, so the watcher does not follow them either.
    followSymlinks: false,
    ignored: (abs: string, stats?: Stats) => {
      const rel = toRel(abs);
      if (rel === '' || rel === '..' || rel.startsWith('../') || path.isAbsolute(rel)) return false;
      const parts = rel.split('/');
      for (let i = 1; i < parts.length; i++) if (ignoredDir(parts.slice(0, i).join('/'))) return true;
      // The path itself: a folder also honours .gitignore; anything else keeps the plain skipped-name rule.
      return stats?.isDirectory() ? ignoredDir(rel) : isSkippedDir(rel);
    },
  });
  const onFile = (abs: string): void => onEvent({ rel: toRel(abs), kind: 'file' });
  watcher.on('add', onFile);
  watcher.on('change', onFile);
  watcher.on('unlink', onFile);
  watcher.on('unlinkDir', (abs: string) => onEvent({ rel: toRel(abs), kind: 'dir-removed' }));
  watcher.on('error', onError);
  await new Promise<void>((resolve) => watcher.once('ready', () => resolve()));
  return { close: () => watcher.close() };
}
