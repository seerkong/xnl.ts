import { canonicalizeObject, type ObjectId } from "./hash";
import { VcsError } from "./errors";
import type { VcsObject } from "./types";

export interface ObjectStore {
  put(object: VcsObject): ObjectId;
  get<T extends VcsObject = VcsObject>(id: ObjectId): T | null;
  has(id: ObjectId): boolean;
  list(): ObjectId[];
}

export class MemoryObjectStore implements ObjectStore {
  private readonly records = new Map<ObjectId, string>();

  put(object: VcsObject): ObjectId {
    const { canonical, hash } = canonicalizeObject(object);
    this.records.set(hash, canonical);
    return hash;
  }

  get<T extends VcsObject = VcsObject>(id: ObjectId): T | null {
    const raw = this.records.get(id);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  }

  has(id: ObjectId): boolean {
    return this.records.has(id);
  }

  list(): ObjectId[] {
    return [...this.records.keys()].sort();
  }
}

export function assertObject<T extends VcsObject>(value: T | null, id: ObjectId): T {
  if (!value) {
    throw new VcsError("ENOENT_OBJECT", `Object not found: ${id}`);
  }
  return value;
}
