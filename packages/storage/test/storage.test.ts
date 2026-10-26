import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { checkKey, diskStorage, StorageKeyError } from '../src/index.js';

const dirs: string[] = [];
const fresh = async () => {
  const d = await mkdtemp(join(tmpdir(), 'agentor-storage-'));
  dirs.push(d);
  return d;
};
afterAll(async () => {
  for (const d of dirs) await rm(d, { recursive: true, force: true });
});

describe('disk storage', () => {
  it('puts, gets, replaces and deletes a file', async () => {
    const s = diskStorage(await fresh());
    const key = 'avatars/0190a000-0000-7000-8000-000000000001/abc.webp';
    expect(await s.get(key)).toBeNull();
    await s.put(key, Buffer.from('one'));
    expect((await s.get(key))!.toString()).toBe('one');
    await s.put(key, Buffer.from('two'));
    expect((await s.get(key))!.toString()).toBe('two');
    expect(await s.exists(key)).toBe(true);
    await s.delete(key);
    expect(await s.exists(key)).toBe(false);
    await s.delete(key);
  });

  it('leaves no temporary files behind', async () => {
    const root = await fresh();
    const s = diskStorage(root);
    await s.put('avatars/x/a.webp', Buffer.from('a'));
    expect(await readdir(join(root, 'avatars', 'x'))).toEqual(['a.webp']);
  });

  it('refuses keys that could leave the root', () => {
    for (const bad of [
      '../etc/passwd',
      'avatars/../../x',
      '/etc/passwd',
      'avatars//x',
      'Avatars/x',
      'avatars/x/',
      'avatars\\x',
      '',
      'a/./b',
    ])
      expect(() => checkKey(bad), bad).toThrow(StorageKeyError);
    expect(checkKey('avatars/0190a000-0000-7000-8000-000000000001/f00.webp')).toBeTruthy();
  });
});
