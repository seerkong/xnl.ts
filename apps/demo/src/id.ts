const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeTime(timeMs: number): string {
  let t = Math.floor(timeMs);
  let out = "";
  for (let i = 0; i < 10; i++) {
    out = ENCODING[t % 32] + out;
    t = Math.floor(t / 32);
  }
  return out;
}

function fillRandom(bytes: Uint8Array): void {
  const c: any = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
    return;
  }
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
}

function encodeRandom(length: number): string {
  const bytes = new Uint8Array(length);
  fillRandom(bytes);

  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += ENCODING[bytes[i] & 31];
  }
  return out;
}

export function ulid(nowMs: number = Date.now()): string {
  return encodeTime(nowMs) + encodeRandom(16);
}

export function makeId(prefix: string): string {
  return `${prefix}${ulid()}`;
}
