import type { XnlMutation } from "xnl-core";

export type DocId = string;
export type ClientId = string;
export type OpId = string;
export type VersionId = string;

export type VersionKind = "root" | "op" | "merge";

export type VersionSummary = {
  id: VersionId;
  parents: VersionId[];
  kind: VersionKind;
  ts: string;
  clientId?: ClientId;
  opId?: OpId;
  mutations?: XnlMutation[];
};

export type ClientToServerMessage =
  | {
      type: "connect";
      docId: DocId;
      clientId: ClientId;
      protocolVersion: 2;
    }
  | {
      type: "op";
      docId: DocId;
      clientId: ClientId;
      opId: OpId;
      baseVersionId: VersionId;
      mutations: XnlMutation[];
    }
  | {
      type: "pull";
      docId: DocId;
      clientId: ClientId;
      opId: OpId;
      baseVersionId: VersionId;
      otherVersionId: VersionId;
    };

export type ServerToClientMessage =
  | {
      type: "doc_state";
      docId: DocId;
      headVersionId: VersionId;
      headText: string;
      versions: VersionSummary[];
    }
  | {
      type: "graph_update";
      docId: DocId;
      headVersionId: VersionId;
      headText: string;
      added: VersionSummary[];
    }
  | {
      type: "ack";
      docId: DocId;
      clientId: ClientId;
      opId: OpId;
      opVersionId: VersionId;
      headVersionId: VersionId;
      status: "integrated" | "merged" | "branched";
    }
  | {
      type: "resync";
      docId: DocId;
      headVersionId: VersionId;
      headText: string;
      reason: "unknown_base" | "apply_failed";
    }
  | {
      type: "error";
      docId?: DocId;
      message: string;
    };

export function isClientToServerMessage(value: unknown): value is ClientToServerMessage {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  const type = v.type;

  if (type === "connect") {
    return typeof v.docId === "string" && typeof v.clientId === "string" && v.protocolVersion === 2;
  }

  if (type === "op") {
    return (
      typeof v.docId === "string" &&
      typeof v.clientId === "string" &&
      typeof v.opId === "string" &&
      typeof v.baseVersionId === "string" &&
      Array.isArray(v.mutations)
    );
  }

  if (type === "pull") {
    return (
      typeof v.docId === "string" &&
      typeof v.clientId === "string" &&
      typeof v.opId === "string" &&
      typeof v.baseVersionId === "string" &&
      typeof v.otherVersionId === "string"
    );
  }

  return false;
}

export function jsonParseMessage<T>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

export function jsonStringifyMessage(msg: unknown): string {
  return JSON.stringify(msg);
}
