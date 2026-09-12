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
  const normalized: string[] = [];
  for (const segment of unix.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      normalized.pop();
      continue;
    }
    normalized.push(segment);
  }
  return normalized;
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
  const fromSegments = toSegments(from);
  const toSegmentsValue = toSegments(to);
  let commonLength = 0;
  while (
    commonLength < fromSegments.length &&
    commonLength < toSegmentsValue.length &&
    fromSegments[commonLength] === toSegmentsValue[commonLength]
  ) {
    commonLength += 1;
  }
  const upward = Array.from({ length: fromSegments.length - commonLength }, () => "..");
  const downward = toSegmentsValue.slice(commonLength);
  return [...upward, ...downward].join("/") || ".";
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
