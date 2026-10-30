import path from 'node:path';
import { isSkippedDir } from '@mapskill/core';
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
  const watcher = watch(root, {
    ignoreInitial: true,
    ignored: (abs: string) => {
      const rel = toRel(abs);
      return rel !== '' && !rel.startsWith('..') && isSkippedDir(rel);
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
