import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { createLocalFsContentJournal } from '../src/local-fs-content-history';
import type { ContentChange, ContentStream } from '../src/content-history';
const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
const stream: ContentStream = { streamId: 'doc', subject: { scope: 'local', id: 'doc', root: 'content' }, profile: { id: 'text/v1', config: {} }, initial: '' };
const change: ContentChange = { streamId: 'doc', profileId: 'text/v1', actorId: 'actor', sessionEpoch: 'epoch', requestId: 'request', groupId: 'group', base: 0, delta: 'hello' };
function fixture() { const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xnl-content-journal-')); roots.push(root); return { root, open: () => createLocalFsContentJournal({ storageRootPath: root }) }; }
it('persists incremental requests and linearizes independently opened writers', async () => {
  const { open } = fixture(), a = open(), b = open(); await a.open(stream); await b.open(stream);
  const result = await Promise.all([a.append(change), b.append({ ...change, actorId: 'other', delta: 'world' })]);
  expect(result.map(r => r.status)).toEqual(['appended', 'conflict']);
  a.close(); b.close(); const reopened = open();
  expect((await reopened.read('doc')).head).toBe(1);
  expect((await reopened.append(change)).status).toBe('duplicate');
  expect((await reopened.lookup('doc', 'actor', 'epoch', 'request'))?.change.delta).toBe('hello');
  expect((await reopened.append({ ...change, delta: 'different' })).status).toBe('conflict');
});
it('a process-equivalent fault after publish is resolved by request lookup', async () => {
  const { open } = fixture(), journal = open(); await journal.open(stream);
  const link = fs.linkSync; vi.spyOn(fs, 'linkSync').mockImplementation((from, to) => { link(from, to); throw Error('CRASH_AFTER_LINK'); });
  await expect(journal.append(change)).rejects.toThrow('CRASH_AFTER_LINK');
  vi.restoreAllMocks(); journal.close(); const reopened = open();
  expect((await reopened.append(change)).status).toBe('duplicate');
  expect((await reopened.read('doc')).head).toBe(1);
});
it('recovery rejects a missing committed interval and ignores private temporary candidates', async () => {
  const { root, open } = fixture(), journal = open(); await journal.open(stream); await journal.append(change);
  await journal.append({ ...change, requestId: 'second', base: 1 }); journal.close();
  const dir = path.join(root, createHash('sha256').update('doc').digest('hex'));
  fs.writeFileSync(path.join(dir, '.pending-incomplete'), '{');
  expect((await open().read('doc')).head).toBe(2);
  fs.unlinkSync(path.join(dir, '1.json'));
  await expect(open().read('doc')).rejects.toThrow('HISTORY_INCOMPLETE_INTERVAL');
});
