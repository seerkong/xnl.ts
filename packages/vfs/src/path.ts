import path from "node:path";
import { VfsError } from "./errors";

export const VFS_SCHEME = "vfs://";
export const VFS_PROJECT = "project";
export const VFS_ROOT = `${VFS_SCHEME}/`;

function ensureScheme(input: string): string {
  if (!input.startsWith(VFS_SCHEME)) {
    throw new VfsError("EINVAL", `Path must start with ${VFS_SCHEME}: ${input}`);
  }
  return input;
}

function stripScheme(input: string): string {
  ensureScheme(input);
  return input.slice(VFS_SCHEME.length);
}

function stripRootBody(input: string): string {
  const body = stripScheme(input);
  if (!body.startsWith("/")) {
    throw new VfsError("EINVAL", `Path must use empty authority root (${VFS_ROOT}): ${input}`);
  }
  return body;
}

function normalizeSegments(raw: string): string[] {
  const unix = raw.replace(/\\/g, "/");
  const joined = path.posix.normalize(unix);
  const parts = joined.split("/").filter(Boolean);
  return parts;
}

export function normalizeVfsPath(input: string): string {
  const body = stripRootBody(input);
  const parts = normalizeSegments(body);
  return parts.length ? `${VFS_ROOT}${parts.join("/")}` : VFS_ROOT;
}

export function joinVfsPath(base: string, ...parts: string[]): string {
  let current = normalizeVfsPath(base);
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith(VFS_SCHEME)) {
      current = normalizeVfsPath(part);
      continue;
    }
    const next = `${current}/${part}`;
    current = normalizeVfsPath(next);
  }
  return current;
}

export function dirnameVfsPath(input: string): string {
  const normalized = normalizeVfsPath(input);
  const parts = toSegments(normalized);
  if (parts.length === 0) return VFS_ROOT;
  const parent = parts.slice(0, -1);
  return parent.length ? `${VFS_ROOT}${parent.join("/")}` : VFS_ROOT;
}

export function basenameVfsPath(input: string): string {
  const parts = toSegments(input);
  return parts[parts.length - 1] ?? "";
}

export function relativeVfsPath(from: string, to: string): string {
  const nFrom = normalizeVfsPath(from);
  const nTo = normalizeVfsPath(to);
  const fromBody = stripScheme(nFrom);
  const toBody = stripScheme(nTo);
  const rel = path.posix.relative(fromBody, toBody);
  return rel || ".";
}

export function toSegments(input: string): string[] {
  const normalized = normalizeVfsPath(input);
  if (normalized === VFS_ROOT) {
    return [];
  }
  return normalized.slice(VFS_ROOT.length).split("/").filter(Boolean);
}

export function assertNotRoot(input: string): void {
  const normalized = normalizeVfsPath(input);
  if (normalized === VFS_ROOT) {
    throw new VfsError("EINVAL", "Operation is not allowed on VFS root");
  }
}
