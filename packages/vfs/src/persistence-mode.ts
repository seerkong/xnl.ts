export type PersistenceMode = "local-fs" | "indexeddb" | "snapshot" | "auto";

export interface PersistenceAutoSelectOptions {
  requestedMode?: PersistenceMode;
  workspaceRootPath?: string;
  indexedDbAvailable?: boolean;
}

export function resolvePersistenceMode(options: PersistenceAutoSelectOptions): Exclude<PersistenceMode, "auto"> {
  const requested = options.requestedMode ?? "auto";
  if (requested !== "auto") {
    return requested;
  }
  if (options.workspaceRootPath) {
    return "local-fs";
  }
  if (options.indexedDbAvailable) {
    return "indexeddb";
  }
  return "snapshot";
}
