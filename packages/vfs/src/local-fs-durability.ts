import fs from 'node:fs';
import path from 'node:path';

export function syncFsDirectory(directory: string): void {
  const fd = fs.openSync(directory, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
/** Sync every newly created directory's parent before acknowledging durability. */
export function ensureDurableDirectory(directory: string): void {
  try {
    const stat = fs.lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('FS_UNSAFE_DIRECTORY');
    return;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const parent = path.dirname(directory);
  ensureDurableDirectory(parent);
  try { fs.mkdirSync(directory); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  if (fs.lstatSync(directory).isSymbolicLink()) throw Error('FS_UNSAFE_DIRECTORY');
  syncFsDirectory(parent);
}
