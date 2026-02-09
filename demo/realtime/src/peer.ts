import { createPeerClient } from "@xnl/collab-client";

function requireElement(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} element`);
  return el;
}

function requireTextarea(id: string): HTMLTextAreaElement {
  const el = requireElement(id);
  if (!(el instanceof HTMLTextAreaElement)) throw new Error(`#${id} must be a textarea`);
  return el;
}

function requireButton(id: string): HTMLButtonElement {
  const el = requireElement(id);
  if (!(el instanceof HTMLButtonElement)) throw new Error(`#${id} must be a button`);
  return el;
}

function requireSpan(id: string): HTMLSpanElement {
  const el = requireElement(id);
  if (!(el instanceof HTMLSpanElement)) throw new Error(`#${id} must be a span`);
  return el;
}

function requirePre(id: string): HTMLPreElement {
  const el = requireElement(id);
  if (!(el instanceof HTMLPreElement)) throw new Error(`#${id} must be a pre`);
  return el;
}

function sanitizeIdentity(input: string): string {
  const trimmed = input.trim();
  const safe = trimmed.replace(/[^a-zA-Z0-9_-]+/g, "_");
  return safe.length ? safe.slice(0, 48) : "anonymous";
}

function wsUrl(): string {
  const u = new URL("/ws", window.location.href);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}

function init() {
  const params = new URL(window.location.href).searchParams;
  const rawDocId = params.get("docId") ?? "default";
  const rawIdentity = params.get("identity") ?? "";

  const docId = rawDocId.trim().length ? rawDocId.trim() : "default";
  const identity = sanitizeIdentity(rawIdentity);

  requireSpan("peerDocId").textContent = docId;
  requireSpan("peerIdentity").textContent = identity;

  const editor = requireTextarea("peerEditor");
  const setButton = requireButton("peerSet");
  const statusEl = requireSpan("peerStatus");
  const revEl = requireSpan("peerRev");
  const parseErrorEl = requirePre("peerParseError");

  const client = createPeerClient({
    docId,
    identity,
    wsUrl,
  });

  const render = () => {
    const s = client.getState();
    statusEl.textContent = s.status;
    revEl.textContent = s.revLabel;
    parseErrorEl.textContent = s.error ?? "";

    setButton.disabled = s.sending || !s.dirty || s.status !== "connected";

    if (!s.dirty && editor.value !== s.text) {
      editor.value = s.text;
    }
  };

  client.subscribe(render);

  if (!params.get("identity")) {
    parseErrorEl.textContent = "Missing required query param: identity";
  }

  editor.addEventListener("input", () => {
    client.setText(editor.value);
  });

  setButton.addEventListener("click", () => {
    const res = client.commit();
    if (res.ok && typeof res.canonicalText === "string") {
      editor.value = res.canonicalText;
    }
  });

  client.connect();
}

init();
