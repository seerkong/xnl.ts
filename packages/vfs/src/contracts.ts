import type { ContractsDocument } from "./types";

export const VFS_CONTRACTS: ContractsDocument = {
  pathExamples: [
    { input: "vfs:///", output: "vfs:///" },
    { input: "vfs:////", output: "vfs:///" },
    { input: "vfs:///src", output: "vfs:///src" },
    { input: "vfs:///src/.", output: "vfs:///src" },
    { input: "vfs:///src/..", output: "vfs:///" },
    { input: "vfs:///src/../README.md", output: "vfs:///README.md" },
    { input: "vfs:////src///main.ts", output: "vfs:///src/main.ts" },
    { input: "vfs:///a/b/../../c", output: "vfs:///c" },
    { input: "vfs:///a\\b", output: "vfs:///a/b" },
    { input: "vfs:///././a", output: "vfs:///a" },
  ],
  errorMappings: [
    { code: "ENOENT", operation: "readFile", trigger: "path does not exist" },
    { code: "EEXIST", operation: "mkdir", trigger: "path already exists" },
    { code: "ENOTDIR", operation: "readdir", trigger: "path points to file" },
    { code: "EISDIR", operation: "readFile", trigger: "path points to folder" },
    { code: "ENOTEMPTY", operation: "rmdir", trigger: "folder has children without recursive option" },
    { code: "EINVAL", operation: "path", trigger: "path is outside vfs:/// root" },
    { code: "ERESERVED", operation: "mkdir/writeFile", trigger: "path attempts to create reserved namespaces (.node-meta/.xnl-vcs)" },
    { code: "BINARY_UNMERGEABLE", operation: "merge(binary)", trigger: "binary payloads differ" },
    { code: "EDETACHEDHEAD", operation: "commit", trigger: "HEAD is detached and no branch ref to move" },
  ],
};
