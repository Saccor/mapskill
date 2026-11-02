// packages/cli/src/open-command.ts
import { spawn } from 'node:child_process';
import path from 'node:path';
import { ensureDaemon } from './daemon/client';
import { isUnsafeRoot, UNSAFE_ROOT_MESSAGE } from './unsafe-root';

type Write = (s: string) => void;

export function mapUrl(info: { port: number; token: string }): string {
  return `http://127.0.0.1:${info.port}/?t=${info.token}`;
}

/** Opens a URL in the default browser. Best effort: errors are ignored. */
export function openInBrowser(url: string): void {
  const [command, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // no browser available: the printed address is enough
  }
}

/** `mapskill open [dir] [--no-browser]`: starts the daemon if needed, prints the map address and opens it. */
export async function runOpen(
  argv: string[],
  deps: { open?: (url: string) => void; write?: Write; home?: string } = {},
): Promise<number> {
  const write = deps.write ?? ((s: string) => void process.stdout.write(s));
  const noBrowser = argv.includes('--no-browser');
  const dir = argv.find((a) => !a.startsWith('--')) ?? '.';
  const root = path.resolve(dir);
  if (isUnsafeRoot(root, deps.home)) {
    write(`${UNSAFE_ROOT_MESSAGE}\n`);
    return 1;
  }
  const info = await ensureDaemon(root, { timeoutMs: 10_000, home: deps.home });
  if (!info) {
    write(`Mapskill daemon is not answering. See ${path.join(root, '.mapskill', 'daemon.log')}\n`);
    return 1;
  }
  const url = mapUrl(info);
  write(`Mapskill map: ${url}\n`);
  if (!noBrowser) (deps.open ?? openInBrowser)(url);
  return 0;
}
