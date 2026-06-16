import type { VfsFileType } from "xnl-vfs";
import { sha256Hex } from "./hash";
import type { ContentKey, ContentType } from "./types";

/**
 * A stored content record. The actual file bytes live here, separated from the
 * blob object. `contentText` holds the payload (base64 for binary, utf8
 * otherwise); `encoding` records which. `contentKey` is content-addressed
 * (sha256 of the payload), enabling dedup.
 */
export interface ContentRecord {
  contentKey: ContentKey;
  contentType: ContentType;
  encoding: "utf8" | "base64";
  contentText: string;
  contentHash: string;
  sizeBytes: number;
}

export interface ContentStore {
  /** Store content, returning its content-addressed key (sha256 of payload). */
  put(content: string, contentType: ContentType): ContentKey;
  /** Resolve the payload string for a content key, or null if absent. */
  get(key: ContentKey): string | null;
  /** Full content record for a key, or null. */
  getRecord(key: ContentKey): ContentRecord | null;
  has(key: ContentKey): boolean;
}

const textEncoder = new TextEncoder();

function byteLength(payload: string): number {
  return textEncoder.encode(payload).length;
}

/** Build a content record for the given payload. Key = hash = sha256(payload). */
export function makeContentRecord(content: string, contentType: ContentType): ContentRecord {
  const contentHash = sha256Hex(content);
  return {
    contentKey: contentHash,
    contentType,
    encoding: encodingForType(contentType),
    contentText: content,
    contentHash,
    sizeBytes: byteLength(content),
  };
}

export function encodingForType(contentType: VfsFileType): "utf8" | "base64" {
  return contentType === "binary" ? "base64" : "utf8";
}

export class MemoryContentStore implements ContentStore {
  private readonly records = new Map<ContentKey, ContentRecord>();

  put(content: string, contentType: ContentType): ContentKey {
    const record = makeContentRecord(content, contentType);
    this.records.set(record.contentKey, record);
    return record.contentKey;
  }

  get(key: ContentKey): string | null {
    return this.records.get(key)?.contentText ?? null;
  }

  getRecord(key: ContentKey): ContentRecord | null {
    return this.records.get(key) ?? null;
  }

  has(key: ContentKey): boolean {
    return this.records.has(key);
  }
}
