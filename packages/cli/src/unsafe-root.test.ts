import path from 'node:path';
import { tmpProject } from '@mapskill/core/test-helpers';
import { describe, expect, it } from 'vitest';
import { isUnsafeRoot, UNSAFE_ROOT_MESSAGE } from './unsafe-root';

describe('isUnsafeRoot', () => {
  it('flags the home folder, also through another spelling', () => {
    const home = tmpProject({ 'package.json': '{}' });
    expect(isUnsafeRoot(home, home)).toBe(true);
    expect(isUnsafeRoot(path.join(home, '.'), home)).toBe(true);
    expect(isUnsafeRoot(`${home}${path.sep}`, home)).toBe(true);
    if (process.platform === 'win32') {
      expect(isUnsafeRoot(home.toUpperCase(), home)).toBe(true);
      expect(isUnsafeRoot(home.toLowerCase(), home.toUpperCase())).toBe(true);
    }
  });

  it('flags a disk root', () => {
    const home = tmpProject({});
    expect(isUnsafeRoot(path.parse(process.cwd()).root, home)).toBe(true);
    expect(isUnsafeRoot(path.parse(home).root, home)).toBe(true);
  });

  it('accepts a project folder, also one inside the home folder', () => {
    const home = tmpProject({ 'proj/package.json': '{}' });
    expect(isUnsafeRoot(path.join(home, 'proj'), home)).toBe(false);
    expect(isUnsafeRoot(tmpProject({ 'package.json': '{}' }), home)).toBe(false);
  });

  it('has a plain message that says what to do', () => {
    expect(UNSAFE_ROOT_MESSAGE).toContain('home folder');
    expect(UNSAFE_ROOT_MESSAGE).toContain('project folder');
  });
});
