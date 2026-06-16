import fs from "node:fs";
import path from "node:path";
import { XNL, parseXnl, type DataElementNode, type XnlNode } from "xnl-core";
import { VfsError } from "./errors";
import {
  createFileNode,
  createFolderNode,
  folderChildren,
  readFileContent,
  readFileType,
  readName,
} from "./model";
import { VirtualFileSystem } from "./vfs";

export interface LocalFsVfsPersistenceOptions {
  workspaceRootPath: string;
  workspaceAuthority?: string;
  nodeSidecarDirName?: ".node-meta";
  nodeSidecarSuffix?: ".node.xnl";
  nodeMetaStorageRootPath?: string;
  skipSidecarWhenNoExtensionMetadata?: boolean;
  vcsDirName?: ".xnl-vcs";
  vcsStorageRootPath?: string;
}

export interface LocalFsLoadResult {
  snapshot: DataElementNode;
  warnings: string[];
  dirty: boolean;
}

const DEFAULT_SIDE_DIR = ".node-meta";
const DEFAULT_SIDE_SUFFIX = ".node.xnl";
const DEFAULT_VCS_DIR = ".xnl-vcs";
const SIDECAR_SYSTEM_METADATA_KEYS = new Set(["id", "name", "refId"]);
const NON_EXTENSION_ATTRIBUTE_KEYS = new Set(["nodeType", "fileType", "content"]);

function cloneNode<T extends XnlNode>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isDataElement(node: XnlNode | undefined): node is DataElementNode {
  return Boolean(node && typeof node === "object" && (node as DataElementNode).kind === "DataElement");
}

function ensureDirSync(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeFileAtomicSync(filePath: string, content: string): void {
  ensureDirSync(path.dirname(filePath));
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, content, "utf8");
  fs.renameSync(tmpPath, filePath);
}

function removePathSync(targetPath: string): void {
  if (!fs.existsSync(targetPath)) {
    return;
  }
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name));
}

function inferFileType(fileName: string): "xnl" | "text" | "binary" {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xnl")) {
    return "xnl";
  }
  if (
    lower.endsWith(".bin") ||
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".gif") ||
    lower.endsWith(".webp")
  ) {
    return "binary";
  }
  return "text";
}

function parseSidecar(input: string): DataElementNode {
  const parsed = parseXnl(input);
  const node = parsed.nodes.find((item) => {
    return isDataElement(item) && (item.tag === "Folder" || item.tag === "File");
  });
  if (!node || !isDataElement(node)) {
    throw new VfsError("EINVAL", "Invalid sidecar: expected <Folder> or <File>");
  }
  return node;
}

function stringifyNode(node: DataElementNode): string {
  return XNL.stringify(node, { pretty: true, indent: 2 });
}

function splitSidecarChannels(node: DataElementNode): {
  metadata: Record<string, XnlNode>;
  attributes: Record<string, XnlNode>;
} {
  const metadataOut: Record<string, XnlNode> = {};
  const attributesOut: Record<string, XnlNode> = {};

  for (const [key, value] of Object.entries(node.metadata ?? {})) {
    if (SIDECAR_SYSTEM_METADATA_KEYS.has(key)) {
      metadataOut[key] = cloneNode(value);
      continue;
    }
    attributesOut[key] = cloneNode(value);
  }

  for (const [key, value] of Object.entries(node.attributes ?? {})) {
    if (key === "content" && node.tag === "file") {
      continue;
    }
    if (SIDECAR_SYSTEM_METADATA_KEYS.has(key)) {
      metadataOut[key] = cloneNode(value);
      continue;
    }
    attributesOut[key] = cloneNode(value);
  }

  return {
    metadata: metadataOut,
    attributes: attributesOut,
  };
}

function sidecarProjection(node: DataElementNode): DataElementNode {
  const split = splitSidecarChannels(node);

  if (node.tag === "folder") {
    const projected: DataElementNode = {
      kind: "DataElement",
      tag: "Folder",
      metadata: split.metadata,
    };
    if (Object.keys(split.attributes).length > 0) {
      projected.attributes = split.attributes;
    }
    if (node.extend) {
      projected.extend = cloneNode(node.extend);
    }
    return projected;
  }
  if (node.tag === "file") {
    const projected: DataElementNode = {
      kind: "DataElement",
      tag: "File",
      metadata: split.metadata,
    };
    if (Object.keys(split.attributes).length > 0) {
      projected.attributes = split.attributes;
    }
    if (node.extend) {
      projected.extend = cloneNode(node.extend);
    }
    return projected;
  }
  throw new VfsError("EINVAL", `Unsupported node tag for sidecar projection: <${node.tag}>`);
}

function hasAttributeExtensionMetadata(node: DataElementNode): boolean {
  const split = splitSidecarChannels(node);
  return Object.keys(split.attributes).some((key) => !NON_EXTENSION_ATTRIBUTE_KEYS.has(key));
}

export class LocalFsVfsPersistence {
  private readonly workspaceRootPath: string;
  private readonly sidecarDirName: ".node-meta";
  private readonly sidecarSuffix: ".node.xnl";
  private readonly vcsDirName: ".xnl-vcs";
  private readonly nodeMetaStorageRootPath?: string;
  private readonly skipSidecarWhenNoExtensionMetadata: boolean;
  private readonly vcsStorageRootPath?: string;

  constructor(options: LocalFsVfsPersistenceOptions) {
    this.workspaceRootPath = options.workspaceRootPath;
    this.sidecarDirName = options.nodeSidecarDirName ?? DEFAULT_SIDE_DIR;
    this.sidecarSuffix = options.nodeSidecarSuffix ?? DEFAULT_SIDE_SUFFIX;
    this.nodeMetaStorageRootPath = options.nodeMetaStorageRootPath;
    this.skipSidecarWhenNoExtensionMetadata = options.skipSidecarWhenNoExtensionMetadata ?? false;
    this.vcsDirName = options.vcsDirName ?? DEFAULT_VCS_DIR;
    this.vcsStorageRootPath = options.vcsStorageRootPath;
  }

  private isWorkspaceSidecarReserved(): boolean {
    return !this.nodeMetaStorageRootPath;
  }

  private isWorkspaceVcsReserved(): boolean {
    return !this.vcsStorageRootPath;
  }

  private sidecarDirPathForDirectory(dirPath: string): string {
    if (!this.nodeMetaStorageRootPath) {
      return path.join(dirPath, this.sidecarDirName);
    }
    const relativePath = path.relative(this.workspaceRootPath, dirPath);
    if (relativePath === "") {
      return path.join(this.nodeMetaStorageRootPath, "root");
    }
    return path.join(this.nodeMetaStorageRootPath, "tree", relativePath);
  }

  private shouldPersistSidecar(node: DataElementNode): boolean {
    if (!this.skipSidecarWhenNoExtensionMetadata) {
      return true;
    }
    if (node.extend) {
      return true;
    }
    return hasAttributeExtensionMetadata(node);
  }

  getReservedNames(): string[] {
    const reservedNames: string[] = [];
    if (this.isWorkspaceSidecarReserved()) {
      reservedNames.push(this.sidecarDirName);
    }
    if (this.isWorkspaceVcsReserved()) {
      reservedNames.push(this.vcsDirName);
    }
    return reservedNames;
  }

  assertManagedName(name: string): void {
    if ((this.isWorkspaceSidecarReserved() && name === this.sidecarDirName) || (this.isWorkspaceVcsReserved() && name === this.vcsDirName)) {
      throw new VfsError("ERESERVED", `Reserved namespace node: ${name}`);
    }
  }

  loadSnapshot(): LocalFsLoadResult {
    ensureDirSync(this.workspaceRootPath);
    const warnings: string[] = [];
    let dirty = false;

    const loadDirectory = (dirPath: string, name: string): DataElementNode => {
      const folder = createFolderNode(name);
      folder.body = [];
      const sidecarDirPath = this.sidecarDirPathForDirectory(dirPath);

      const dirEntries = fs.readdirSync(dirPath, { withFileTypes: true });
      const managedEntries = dirEntries.filter((entry) => {
        if ((this.isWorkspaceSidecarReserved() && entry.name === this.sidecarDirName) || (this.isWorkspaceVcsReserved() && entry.name === this.vcsDirName)) {
          return false;
        }
        return entry.isFile() || entry.isDirectory();
      });

      const sidecarByName = new Set<string>();
      if (fs.existsSync(sidecarDirPath)) {
        const sidecars = fs.readdirSync(sidecarDirPath, { withFileTypes: true });
        for (const sidecar of sidecars) {
          if (!sidecar.isFile()) {
            continue;
          }
          if (!sidecar.name.endsWith(this.sidecarSuffix)) {
            continue;
          }
          sidecarByName.add(sidecar.name.slice(0, -this.sidecarSuffix.length));
        }
      }

      for (const entry of sortByName(managedEntries)) {
        this.assertManagedName(entry.name);
        const entryPath = path.join(dirPath, entry.name);
        let node: DataElementNode;

        if (entry.isDirectory()) {
          node = loadDirectory(entryPath, entry.name);
        } else {
          const fileType = inferFileType(entry.name);
          const content = fileType === "binary" ? fs.readFileSync(entryPath).toString("base64") : fs.readFileSync(entryPath, "utf8");
          node = createFileNode(entry.name, content, fileType);
        }

        const sidecarPath = path.join(sidecarDirPath, `${entry.name}${this.sidecarSuffix}`);
        if (!fs.existsSync(sidecarPath)) {
          if (this.shouldPersistSidecar(node)) {
            warnings.push(`Missing sidecar: ${sidecarPath}`);
            dirty = true;
          }
        } else {
          try {
            const sidecar = parseSidecar(fs.readFileSync(sidecarPath, "utf8"));
            const sidecarMetadata = sidecar.metadata ?? {};
            const sidecarAttributes = sidecar.attributes ?? {};
            const sidecarId = typeof sidecarMetadata.id === "string" ? sidecarMetadata.id : typeof sidecarAttributes.id === "string" ? sidecarAttributes.id : undefined;
            if (sidecarId) {
              node.metadata.id = sidecarId;
            } else {
              warnings.push(`Sidecar missing metadata.id: ${sidecarPath}`);
              dirty = true;
            }
            const sidecarRefId = typeof sidecarMetadata.refId === "string" ? sidecarMetadata.refId : typeof sidecarAttributes.refId === "string" ? sidecarAttributes.refId : undefined;
            if (sidecarRefId) {
              node.metadata.refId = sidecarRefId;
            } else {
              delete node.metadata.refId;
            }
            if (sidecar.extend) {
              node.extend = cloneNode(sidecar.extend);
            } else {
              delete node.extend;
            }
            for (const [key, value] of Object.entries(sidecarMetadata)) {
              if (SIDECAR_SYSTEM_METADATA_KEYS.has(key)) {
                continue;
              }
              node.attributes = {
                ...(node.attributes ?? {}),
                [key]: cloneNode(value),
              };
            }
            for (const [key, value] of Object.entries(sidecarAttributes)) {
              if (SIDECAR_SYSTEM_METADATA_KEYS.has(key)) {
                continue;
              }
              node.attributes = {
                ...(node.attributes ?? {}),
                [key]: cloneNode(value),
              };
            }
          } catch {
            warnings.push(`Corrupt sidecar: ${sidecarPath}`);
            dirty = true;
          }
        }

        folder.body.push(node);
      }

      for (const orphanName of [...sidecarByName].sort((a, b) => a.localeCompare(b))) {
        const present = managedEntries.some((entry) => entry.name === orphanName);
        if (present) {
          continue;
        }
        warnings.push(`Orphan sidecar: ${path.join(sidecarDirPath, `${orphanName}${this.sidecarSuffix}`)}`);
        dirty = true;
      }

      return folder;
    };

    const snapshot = loadDirectory(this.workspaceRootPath, "project");
    if (dirty) {
      this.saveSnapshot(snapshot);
    }

    return { snapshot, warnings, dirty };
  }

  saveSnapshot(snapshot: DataElementNode): void {
    if (snapshot.tag !== "folder") {
      throw new VfsError("EINVAL", "VFS snapshot root must be a folder node");
    }

    const syncDirectory = (folderNode: DataElementNode, dirPath: string): void => {
      ensureDirSync(dirPath);
      const sidecarDirPath = this.sidecarDirPathForDirectory(dirPath);
      ensureDirSync(sidecarDirPath);

      const desiredChildren = sortByName(
        folderChildren(folderNode).map((child) => ({
          name: readName(child),
          node: child,
        }))
      );

      for (const child of desiredChildren) {
        this.assertManagedName(child.name);
      }

      const desiredNames = new Set(desiredChildren.map((child) => child.name));
      const existing = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of existing) {
        if ((this.isWorkspaceSidecarReserved() && entry.name === this.sidecarDirName) || (this.isWorkspaceVcsReserved() && entry.name === this.vcsDirName)) {
          continue;
        }
        if (!desiredNames.has(entry.name)) {
          removePathSync(path.join(dirPath, entry.name));
        }
      }

      for (const child of desiredChildren) {
        const childPath = path.join(dirPath, child.name);
        if (child.node.tag === "folder") {
          syncDirectory(child.node, childPath);
        } else if (child.node.tag === "file") {
          const content = readFileContent(child.node);
          const fileType = readFileType(child.node);
          if (fileType === "binary") {
            const buffer = Buffer.from(content, "base64");
            const tmp = `${childPath}.${process.pid}.${Date.now()}.tmp`;
            ensureDirSync(path.dirname(childPath));
            fs.writeFileSync(tmp, buffer);
            fs.renameSync(tmp, childPath);
          } else {
            writeFileAtomicSync(childPath, content);
          }
        } else {
          throw new VfsError("EINVAL", `Unsupported node tag in snapshot: <${child.node.tag}>`);
        }

        const sidecarPath = path.join(sidecarDirPath, `${child.name}${this.sidecarSuffix}`);
        if (this.shouldPersistSidecar(child.node)) {
          writeFileAtomicSync(sidecarPath, stringifyNode(sidecarProjection(child.node)));
        } else {
          removePathSync(sidecarPath);
        }
      }

      const existingSidecars = fs.readdirSync(sidecarDirPath, { withFileTypes: true });
      for (const sidecar of existingSidecars) {
        if (!sidecar.isFile() || !sidecar.name.endsWith(this.sidecarSuffix)) {
          continue;
        }
        const baseName = sidecar.name.slice(0, -this.sidecarSuffix.length);
        if (!desiredNames.has(baseName)) {
          removePathSync(path.join(sidecarDirPath, sidecar.name));
        }
      }
    };

    syncDirectory(snapshot, this.workspaceRootPath);
  }

  saveFromVfs(vfs: VirtualFileSystem): void {
    this.saveSnapshot(vfs.getSnapshot());
  }

  loadIntoVfs(vfs: VirtualFileSystem): LocalFsLoadResult {
    const result = this.loadSnapshot();
    vfs.loadSnapshot(result.snapshot);
    return result;
  }
}
