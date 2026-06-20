import { parseXnl } from "../parser";
import { batchLoad } from "../loader";
import { DataElementNode, XnlDocument, XnlNode, AttributeMap, isWord, wordToString } from "../types";

/**
 * vfs-import resolver: resolves document-head `<Imports><Import as="X" src="vfs://...">`
 * directives into per-alias symbol tables, reusing the loader export/batchLoad mechanism.
 *
 * Dependency inversion: this module never touches the filesystem. The caller supplies an
 * `ImportResolver` (xnl-vfs, codument, or a test mock) that reads vfs paths.
 */

export type XnlImportErrorCode =
  | "INVALID_IMPORT"
  | "IMPORT_NOT_FOUND"
  | "DUPLICATE_IMPORT"
  | "UNRESOLVED_IMPORT";

export class XnlImportError extends Error {
  code: XnlImportErrorCode;
  constructor(code: XnlImportErrorCode, message: string) {
    super(message);
    this.name = "XnlImportError";
    this.code = code;
  }
}

export interface ImportResolver {
  /** Return file content for a normalized vfs path, or null if it does not exist. */
  readFile(vfsPath: string): string | null;
  /** Return directory entry names for a vfs dir, or null if not a directory. */
  readDir(vfsPath: string): string[] | null;
  /** Whether the vfs path is a directory. */
  isDir(vfsPath: string): boolean;
}

export interface ResolveImportsOptions {
  /** vfs directory of the importing document (for `./` and `../` resolution). */
  baseDir: string;
  /** vfs workspace root (for `@/` resolution). */
  workspaceRoot: string;
}

/** alias -> exported-name -> node */
export type ImportSymbols = Record<string, Record<string, XnlNode>>;

export interface ResolveImportsResult {
  resolved: XnlDocument;
  symbols: ImportSymbols;
  warnings: string[];
}

const VFS_PREFIX = "vfs://";

function isDataElement(node: XnlNode | undefined): node is DataElementNode {
  return Boolean(node && typeof node === "object" && (node as DataElementNode).kind === "DataElement");
}

function readStringMeta(meta: AttributeMap | undefined, key: string): string | undefined {
  const v = meta?.[key];
  if (typeof v === "string") return v;
  if (isWord(v)) return wordToString(v) ?? undefined;
  return undefined;
}

/** Join path parts and collapse `.`/`..` segments into an absolute vfs path. */
function joinAndNormalize(...parts: string[]): string {
  const segs: string[] = [];
  for (const part of parts) {
    for (const s of part.split("/")) {
      if (s === "" || s === ".") continue;
      if (s === "..") {
        if (segs.length) segs.pop();
        continue;
      }
      segs.push(s);
    }
  }
  return "/" + segs.join("/");
}

/** Resolve a `vfs://...` src against base/workspace per the three addressing forms. */
export function resolveVfsSrc(src: string, opts: ResolveImportsOptions): string {
  if (!src.startsWith(VFS_PREFIX)) {
    throw new XnlImportError("INVALID_IMPORT", `Import src must be a vfs:// path: ${src}`);
  }
  const rest = src.slice(VFS_PREFIX.length);
  if (rest === "@" || rest.startsWith("@/")) {
    return joinAndNormalize(opts.workspaceRoot, rest.startsWith("@/") ? rest.slice(2) : "");
  }
  if (rest.startsWith("./") || rest.startsWith("../") || rest === "..") {
    return joinAndNormalize(opts.baseDir, rest);
  }
  // bare or absolute -> workspace-root relative
  return joinAndNormalize(opts.workspaceRoot, rest);
}

/** Parse one xnl document's exported symbols via the loader (export=true / Prefabs). */
function collectExports(content: string): ImportSymbols {
  const doc = parseXnl(content);
  const batch = doc.nodes.filter(isDataElement);
  const { exports } = batchLoad([batch]);
  return exports;
}

interface LoadedSource {
  srcPath: string;
  exports: ImportSymbols;
}

function loadImportTarget(target: string, resolver: ImportResolver): LoadedSource[] {
  if (resolver.isDir(target)) {
    const entries = (resolver.readDir(target) ?? []).filter((e) => e.endsWith(".xnl")).sort();
    const out: LoadedSource[] = [];
    for (const entry of entries) {
      const p = joinAndNormalize(target, entry);
      const content = resolver.readFile(p);
      if (content == null) continue;
      out.push({ srcPath: p, exports: collectExports(content) });
    }
    return out;
  }
  const content = resolver.readFile(target);
  if (content == null) {
    throw new XnlImportError("IMPORT_NOT_FOUND", `Import source not found: ${target}`);
  }
  return [{ srcPath: target, exports: collectExports(content) }];
}

function mergeIntoSymbols(
  symbols: ImportSymbols,
  provenance: Record<string, string>,
  alias: string,
  source: LoadedSource,
): void {
  const ns = (symbols[alias] = symbols[alias] ?? {});
  for (const tag of Object.keys(source.exports)) {
    for (const name of Object.keys(source.exports[tag])) {
      const provKey = `${alias}|${name}`;
      const prevSrc = provenance[provKey];
      if (prevSrc !== undefined && prevSrc !== source.srcPath) {
        throw new XnlImportError(
          "DUPLICATE_IMPORT",
          `Duplicate import symbol '${alias}:${name}' from '${prevSrc}' and '${source.srcPath}'`,
        );
      }
      provenance[provKey] = source.srcPath;
      ns[name] = source.exports[tag][name];
    }
  }
}

function collectImportDirectives(importsNode: DataElementNode): DataElementNode[] {
  const out: DataElementNode[] = [];
  for (const child of importsNode.body ?? []) {
    if (isDataElement(child) && child.tag === "Import") out.push(child);
  }
  if (importsNode.extend) {
    for (const tag of importsNode.extend.order) {
      const child = importsNode.extend.children[tag];
      if (isDataElement(child) && child.tag === "Import") out.push(child);
    }
  }
  return out;
}

const REF_RE = /^([A-Za-z_][\w-]*):([A-Za-z_][\w.\-]*)$/;

/** Validate `alias:name` references in the document against the imported symbols. */
function validateReferences(rootDoc: XnlDocument, symbols: ImportSymbols): void {
  const check = (value: XnlNode | undefined): void => {
    if (typeof value !== "string") return;
    const m = REF_RE.exec(value);
    if (!m) return;
    const [, alias, name] = m;
    if (symbols[alias] !== undefined && symbols[alias][name] === undefined) {
      throw new XnlImportError("UNRESOLVED_IMPORT", `Unresolved import reference '${value}'`);
    }
  };
  const walk = (node: XnlNode): void => {
    if (isDataElement(node)) {
      for (const v of Object.values(node.metadata ?? {})) check(v);
      for (const v of Object.values(node.attributes ?? {})) check(v);
      for (const child of node.body ?? []) walk(child);
      if (node.extend) {
        for (const tag of node.extend.order) walk(node.extend.children[tag]);
      }
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
    }
  };
  for (const node of rootDoc.nodes) walk(node);
}

/**
 * Resolve a document's `<Imports>` directives into per-alias symbol tables.
 * Documents without an `<Imports>` container are returned unchanged (zero-import fallback).
 */
export function resolveImports(
  rootDoc: XnlDocument,
  resolver: ImportResolver,
  opts: ResolveImportsOptions,
): ResolveImportsResult {
  const importsNode = rootDoc.nodes.find(
    (n) => isDataElement(n) && n.tag === "Imports",
  ) as DataElementNode | undefined;
  if (!importsNode) {
    return { resolved: rootDoc, symbols: {}, warnings: [] };
  }

  const symbols: ImportSymbols = {};
  const provenance: Record<string, string> = {};
  const warnings: string[] = [];

  for (const directive of collectImportDirectives(importsNode)) {
    const alias = readStringMeta(directive.metadata, "as");
    const src = readStringMeta(directive.metadata, "src");
    if (!alias || !src) {
      throw new XnlImportError("INVALID_IMPORT", "<Import> requires both 'as' and 'src'");
    }
    const target = resolveVfsSrc(src, opts);
    for (const source of loadImportTarget(target, resolver)) {
      mergeIntoSymbols(symbols, provenance, alias, source);
    }
  }

  validateReferences(rootDoc, symbols);
  return { resolved: rootDoc, symbols, warnings };
}
