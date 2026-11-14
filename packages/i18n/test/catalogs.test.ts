import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

type Tree = { [k: string]: string | Tree };
const dir = join(import.meta.dirname, '..', 'messages');
const load = (l: string) => JSON.parse(readFileSync(join(dir, `${l}.json`), 'utf8')) as Tree;

function keys(t: Tree, prefix = ''): string[] {
  return Object.entries(t).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : keys(v, `${prefix}${k}.`),
  );
}

describe('message catalogs', () => {
  const da = load('da');
  const en = load('en');

  it('ships exactly da and en', () => {
    expect(readdirSync(dir).sort()).toEqual(['da.json', 'en.json']);
  });

  it('has the same keys in Danish and English', () => {
    const dk = keys(da).sort();
    const ek = keys(en).sort();
    expect(
      dk.filter((k) => !ek.includes(k)),
      'missing in en.json',
    ).toEqual([]);
    expect(
      ek.filter((k) => !dk.includes(k)),
      'missing in da.json',
    ).toEqual([]);
  });

  it('has no empty strings', () => {
    for (const [name, cat] of [
      ['da', da],
      ['en', en],
    ] as const) {
      const empty = keys(cat).filter((k) => {
        const v = k.split('.').reduce<string | Tree>((o, p) => (o as Tree)[p]!, cat);
        return typeof v === 'string' && v.trim() === '';
      });
      expect(empty, `${name}.json`).toEqual([]);
    }
  });

  it('keeps English jargon out of the Danish UI (designspecifikation §9.2)', () => {
    const banned = /\b(pipeline|deploy|edge|credential|job|sync failed|run)\b/i;
    const hits = keys(da).filter((k) => {
      const v = k.split('.').reduce<string | Tree>((o, p) => (o as Tree)[p]!, da) as string;
      return banned.test(v);
    });
    expect(hits).toEqual([]);
  });
});
