import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { VirtualFileSystem } from './vfs';
import { historyCanonical } from './content-history';
import { encodeXnlHistoryValue } from './xnl-content-history';
import { ensureDurableDirectory, syncFsDirectory as syncDirectory } from './local-fs-durability';
import type { DataElementNode } from 'xnl-core';
import type { RevisionedVfsAuthority, RevisionedVfsFlushInput, RevisionedVfsOperationResult, VfsRevision } from './revisioned-persistence';

type Entry = { kind: 'file' | 'folder'; id: string; identity: string; revision: string; content?: string; codec?: 'text' | 'binary' };
type Entries = Record<string, Entry>;
type Step = { file: string; before: Entry | null; after: Entry | null; staged: string };
type Plan = { operationId: string; fingerprint: string; before: VfsRevision; entries: Entries; steps: Step[] };
const hash = (value: unknown) => createHash('sha256').update(historyCanonical(value)).digest('hex');
function durableJson(file: string, value: unknown) {
  ensureDurableDirectory(path.dirname(file));
  const temporary = `${file}.${randomUUID()}`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, historyCanonical(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file); syncDirectory(path.dirname(file));
}
const readJson = <T>(file: string): T | undefined => {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
};

/** The host calls this under the same publication lock as the raw workspace.
 * Resource-aware saves and raw moves therefore refer to one physical file ID,
 * while FQN and private document subject IDs retain their separate meanings. */
export function ensureManagedFileIdentity(storageRoot: string, logicalPath: string): string {
  if (!logicalPath || logicalPath.startsWith('/') || logicalPath.includes('\\') || logicalPath.split('/').some(part => !part || part === '.' || part === '..')) throw Error('FS_PATH_DENIED');
  const file = path.join(storageRoot, 'identities.json'), known = readJson<Record<string, { id: string; codec?: string }>>(file) ?? {};
  if (known[logicalPath]?.id) return known[logicalPath].id;
  const id = randomUUID(); Object.defineProperty(known, logicalPath, { value: { id }, enumerable: true, writable: true, configurable: true }); durableJson(file, known); return id;
}

/** Explicitly managed raw author directory. Uses original VFS identities and
 * bytes, not filename-based mutation dispatch. Multi-file publication is
 * recoverable roll-forward, NOT externally atomic. Pending publication blocks
 * reads; a retry resumes the exact immutable plan. The host must supply an
 * interprocess lock shared with its other source writers and reauthorize paths.
 * Non-cooperating OS writers can still race; observed drift is a conflict. */
export function createManagedFsWorkspace(config: {
  root: string; storageRoot: string; authorityId: string; excludedNames?: string[];
  exclusive<T>(task: () => Promise<T>): Promise<T>;
  authorize(paths: readonly string[]): Promise<void>;
}): RevisionedVfsAuthority {
  const root = path.resolve(config.root), storage = path.resolve(config.storageRoot);
  if (fs.realpathSync(root) !== root) throw Error('FS_ROOT_SYMLINK');
  const excluded = new Set(config.excludedNames ?? ['.node-meta', '.xnl-vcs']);
  if (storage === root || (storage.startsWith(root + path.sep) && !excluded.has(path.relative(root, storage).split(path.sep)[0]))) throw Error('FS_STORAGE_MUST_BE_EXCLUDED');
  let ancestor = storage;
  while (ancestor !== path.dirname(ancestor)) {
    try { if (fs.lstatSync(ancestor).isSymbolicLink()) throw Error('FS_STORAGE_SYMLINK'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    ancestor = path.dirname(ancestor);
  }
  const pendingPath = path.join(storage, 'pending.json'), idsPath = path.join(storage, 'identities.json');
  function safe(relative: string) {
    if (fs.lstatSync(root).isSymbolicLink()) throw Error('FS_ROOT_SYMLINK');
    if (!relative || relative.startsWith('/') || relative.includes('\\') || relative.split('/').some(part => !part || part === '.' || part === '..' || excluded.has(part))) throw Error('FS_PATH_DENIED');
    let cursor = root;
    for (const part of relative.split('/')) {
      cursor = path.join(cursor, part);
      try { if (fs.lstatSync(cursor).isSymbolicLink()) throw Error('FS_PATH_SYMLINK'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return cursor;
  }
  function observe(file: string, id: string, codec?: Entry['codec']): Entry | null {
    let stat: fs.BigIntStats;
    try { stat = fs.lstatSync(file, { bigint: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw Error('FS_ENTRY_UNSUPPORTED');
    const identity = `${stat.dev}:${stat.ino}`;
    if (stat.isDirectory()) return { kind: 'folder', id, identity, revision: hash({ identity }) };
    const bytes = fs.readFileSync(file), after = fs.lstatSync(file, { bigint: true });
    if (stat.ctimeNs !== after.ctimeNs || stat.mtimeNs !== after.mtimeNs || stat.ino !== after.ino) throw Error('FS_READ_CONFLICT');
    let content: string;
    if (codec === 'binary') content = bytes.toString('base64');
    else {
      try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); codec = 'text'; }
      catch { if (codec === 'text') throw Error('FS_CODEC_CHANGED'); codec = 'binary'; content = bytes.toString('base64'); }
    }
    return { kind: 'file', id, identity, revision: hash({ identity, time: String(stat.ctimeNs), modified: String(stat.mtimeNs), bytes: bytes.toString('base64') }), content, codec };
  }
  function scan() {
    const known = readJson<Entries>(idsPath) ?? {}, entries: Entries = Object.create(null);
    function walk(relative: string) {
      for (const name of fs.readdirSync(path.join(root, relative)).sort()) {
        if (excluded.has(name)) continue;
        const logical = relative ? `${relative}/${name}` : name;
        const entry = observe(safe(logical), known[logical]?.id ?? randomUUID(), known[logical]?.codec)!;
        entries[logical] = entry;
        if (entry.kind === 'folder') walk(logical);
      }
    }
    walk('');
    // Persist only identity/codec hints, never an alternative author source.
    const hints = { ...known, ...Object.fromEntries(Object.entries(entries).map(([name, entry]) => [name, { id: entry.id, ...(entry.codec ? { codec: entry.codec } : {}) }])) };
    if (historyCanonical(hints) !== historyCanonical(known)) durableJson(idsPath, hints);
    return entries;
  }
  function revision(entries: Entries): VfsRevision {
    return { authorityId: config.authorityId, value: hash(Object.entries(entries).map(([name, value]) => [name, value.id, value.revision])) };
  }
  function snapshot(entries: Entries) {
    const vfs = new VirtualFileSystem();
    for (const [name, entry] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
      const file = `vfs:///${name}`;
      if (entry.kind === 'folder') vfs.mkdir(file, { recursive: true });
      else vfs.writeFile(file, entry.content!, { fileType: entry.codec!, metadataId: entry.id });
    }
    // Original VFS mkdir has no identity option; set existing folder identities
    // through its snapshot model, retaining identities across move/reopen.
    const result = vfs.getSnapshot();
    result.metadata!.id = `root:${config.authorityId}`;
    const assign = (node: DataElementNode, parent: string) => {
      for (const child of node.body ?? []) if (child && typeof child === 'object' && !Array.isArray(child) && 'kind' in child && child.kind === 'DataElement') {
        const item = child as DataElementNode, name = parent + String(item.metadata!.name);
        item.metadata!.id = entries[name].id;
        if (item.tag === 'folder') assign(item, name + '/');
      }
    };
    assign(result, ''); return result;
  }
  function desired(tree: DataElementNode): Entries {
    const vfs = new VirtualFileSystem(tree), entries: Entries = Object.create(null);
    const ids = new Set<string>([String(tree.metadata?.id)]);
    function walk(folder: string) {
      for (const entry of vfs.readdir(folder)) {
        const name = entry.path.slice('vfs:///'.length); safe(name);
        if (ids.has(entry.metadataId)) throw Error('FS_DUPLICATE_ID'); ids.add(entry.metadataId);
        if (entry.kind === 'folder') { entries[name] = { kind: 'folder', id: entry.metadataId, identity: '', revision: '' }; walk(entry.path); }
        else {
          if (entry.fileType !== 'text' && entry.fileType !== 'binary') throw Error('FS_RAW_PROFILE_REQUIRED');
          const codec = entry.fileType === 'binary' ? 'binary' : 'text', content = vfs.readFile(entry.path);
          if (codec === 'binary' && Buffer.from(content, 'base64').toString('base64') !== content) throw Error('FS_BINARY_INVALID');
          if (codec === 'text' && Buffer.from(content, 'utf8').toString('utf8') !== content) throw Error('FS_TEXT_INVALID');
          entries[name] = { kind: 'file', id: entry.metadataId, identity: '', revision: '', content, codec };
        }
      }
    }
    walk('vfs:///'); return entries;
  }
  function canonicalTree(tree: DataElementNode) {
    const copy = structuredClone(tree);
    const sort = (node: DataElementNode) => {
      if (node.tag !== 'folder') return;
      const children = (node.body ?? []) as DataElementNode[];
      children.forEach(sort);
      children.sort((a, b) => String(a.metadata?.name).localeCompare(String(b.metadata?.name)));
    };
    sort(copy); return historyCanonical(encodeXnlHistoryValue(copy));
  }
  const operationDir = (id: string) => path.join(storage, 'operations', hash(id));
  const sameMaterial = (a: Entry | null, b: Entry | null) => a?.kind === b?.kind && a?.content === b?.content && a?.codec === b?.codec;
  const hasPublished = (step: Step) => {
    const current = observe(safe(step.file), step.after?.id ?? step.before!.id, step.after?.codec);
    if (step.after) return !!current && current.identity === step.after.identity && sameMaterial(current, step.after);
    const trash = observe(step.staged, step.before!.id, step.before?.codec);
    return current === null && trash?.identity === step.before!.identity;
  };
  function finish(plan: Plan): RevisionedVfsOperationResult {
    // Confirm the actual author tree before acknowledging a completed batch.
    const actual = scan();
    if (Object.keys(actual).length !== Object.keys(plan.entries).length
      || Object.entries(plan.entries).some(([name, entry]) => !sameMaterial(actual[name] ?? null, entry))) throw Error('FS_PUBLICATION_EXTERNAL_DRIFT');
    const hints = Object.fromEntries(Object.entries(plan.entries).map(([name, entry]) => [name, { id: entry.id, ...(entry.codec ? { codec: entry.codec } : {}) }]));
    durableJson(idsPath, hints);
    const after = scan(), nextRevision = revision(after);
    const result: RevisionedVfsOperationResult = historyCanonical(nextRevision) === historyCanonical(plan.before)
      ? { status: 'unchanged', revision: nextRevision } : { status: 'applied', receipt: {
      previousRevision: plan.before, revision: revision(after), persistedAt: new Date().toISOString(), durability: 'workspace' } };
    durableJson(path.join(operationDir(plan.operationId), 'receipt.json'), result);
    fs.unlinkSync(pendingPath); syncDirectory(storage); return result;
  }
  async function publish(plan: Plan) {
    await config.authorize(plan.steps.map(step => step.file));
    for (const [index, step] of plan.steps.entries()) {
      const marker = path.join(operationDir(plan.operationId), `step-${index}.json`);
      if (readJson(marker)) continue;
      if (hasPublished(step)) { durableJson(marker, { published: true }); continue; }
      const current = observe(safe(step.file), step.before?.id ?? step.after!.id, step.before?.codec);
      if ((current?.revision ?? null) !== (step.before?.revision ?? null)) throw Error('FS_PUBLICATION_CONFLICT');
      if (step.after) {
        const staged = observe(step.staged, step.after.id, step.after.codec);
        if (!staged || staged.identity !== step.after.identity || !sameMaterial(staged, step.after)) throw Error('FS_STAGED_CHANGED');
        fs.renameSync(step.staged, safe(step.file));
      } else {
        if (current?.kind === 'folder' && fs.readdirSync(safe(step.file)).length) throw Error('FS_DIRECTORY_CHANGED');
        fs.renameSync(safe(step.file), step.staged);
      }
      syncDirectory(path.dirname(safe(step.file))); syncDirectory(path.dirname(step.staged));
      durableJson(marker, { published: true });
    }
    return finish(plan);
  }
  return {
    read: () => config.exclusive(async () => {
      if (readJson(pendingPath)) throw Error('FS_PUBLICATION_PENDING');
      const entries = scan(); return { snapshot: snapshot(entries), revision: revision(entries) };
    }),
    lookupOperation: operationId => config.exclusive(async () => {
      const existing = readJson<RevisionedVfsOperationResult>(path.join(operationDir(operationId), 'receipt.json'));
      if (existing) {
        if (readJson<Plan>(pendingPath)?.operationId === operationId) { fs.unlinkSync(pendingPath); syncDirectory(storage); }
        return existing;
      }
      const pending = readJson<Plan>(pendingPath);
      if (pending?.operationId === operationId && pending.steps.every((step, index) => readJson(path.join(operationDir(operationId), `step-${index}.json`)) || hasPublished(step))) return finish(pending);
      return undefined;
    }),
    compareAndSwap: (input: RevisionedVfsFlushInput) => config.exclusive(async () => {
      if (!input.operationId || input.operationId.length > 512) throw Error('FS_OPERATION_REQUIRED');
      let candidate: Entries;
      // A physical directory has no sibling ordering; all other VFS channels
      // must round-trip, or be explicitly rejected instead of silently dropped.
      try {
        candidate = desired(input.snapshot);
        if (canonicalTree(snapshot(candidate)) !== canonicalTree(input.snapshot)) throw Error('FS_UNSUPPORTED_VFS_METADATA');
      } catch (error) {
        const rejectedInput = error instanceof Error && ['FS_TEXT_INVALID', 'FS_BINARY_INVALID', 'FS_RAW_PROFILE_REQUIRED',
          'FS_UNSUPPORTED_VFS_METADATA', 'FS_DUPLICATE_ID', 'FS_PATH_DENIED'].includes(error.message);
        if (!rejectedInput || readJson(pendingPath) || readJson(path.join(operationDir(input.operationId), 'plan.json'))) throw error;
        // No publication was prepared. Tell the coordinator this is a definite
        // rejection so its outbox can close; unknown IO failures still throw.
        return { status: 'failed' as const, actualRevision: revision(scan()), diagnostics: [{ code: error.message, message: error.message }] };
      }
      const fingerprint = hash({ revision: input.expectedRevision, entries: candidate });
      const dir = operationDir(input.operationId), original = readJson<Plan>(path.join(dir, 'plan.json'));
      if (original && original.fingerprint !== fingerprint) throw Error('FS_OPERATION_REUSED');
      const receipt = readJson<RevisionedVfsOperationResult>(path.join(dir, 'receipt.json'));
      if (receipt) return receipt;
      const pending = readJson<Plan>(pendingPath);
      if (pending) {
        if (pending.operationId !== input.operationId) throw Error('FS_PUBLICATION_PENDING');
        return publish(pending);
      }
      if (original) { durableJson(pendingPath, original); return publish(original); }
      const before = scan();
      if (historyCanonical(revision(before)) !== historyCanonical(input.expectedRevision)) return { status: 'conflict' as const, actualRevision: revision(before) };
      const after = desired(input.snapshot), steps: Step[] = [];
      const removed = Object.keys(before).filter(name => !after[name] || after[name].kind !== before[name].kind).sort((a, b) => b.split('/').length - a.split('/').length);
      const writes = Object.keys(after).filter(name => !sameMaterial(before[name] ?? null, after[name])).sort((a, b) => a.split('/').length - b.split('/').length);
      await config.authorize([...new Set([...removed, ...writes])]);
      ensureDurableDirectory(dir);
      for (const name of removed) steps.push({ file: name, before: before[name], after: null, staged: path.join(dir, `removed-${steps.length}`) });
      for (const name of writes) {
        const staged = path.join(dir, `new-${steps.length}`), entry = after[name];
        if (entry.kind === 'folder') fs.mkdirSync(staged);
        else { const fd = fs.openSync(staged, 'wx', 0o600); try { fs.writeFileSync(fd, Buffer.from(entry.content!, entry.codec === 'binary' ? 'base64' : 'utf8')); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
        const prepared = observe(staged, entry.id, entry.codec)!;
        steps.push({ file: name, before: removed.includes(name) ? null : before[name] ?? null, after: prepared, staged });
      }
      syncDirectory(dir);
      const plan: Plan = { operationId: input.operationId, fingerprint, before: input.expectedRevision, entries: after, steps };
      durableJson(path.join(dir, 'plan.json'), plan); durableJson(pendingPath, plan);
      return publish(plan);
    }),
  };
}
