import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pages = ['index.html', 'login.html', 'store.html', 'meeting.html', 'about.html', 'contact.html', 'umukomite.html'];

for (const page of pages) {
  test(`${page} inline scripts parse`, async () => {
    const html = await readFile(path.join(projectRoot, page), 'utf8');
    const scriptTags = html.matchAll(/<script\b(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi);
    let index = 0;
    for (const [, attributes, source] of scriptTags) {
      if (/\btype\s*=\s*["']application\/(?:ld\+)?json["']/i.test(attributes)) continue;
      index++;
      const result = spawnSync(process.execPath, ['--check', '--input-type=module'], { input: source, encoding: 'utf8' });
      assert.equal(result.status, 0, `${page}:inline-${index} did not parse: ${result.stderr}`);
    }
  });
}
