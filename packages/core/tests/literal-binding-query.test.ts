import { describe, expect, it } from 'vitest';
import { applyMutations, captureImmutableData, capturedLiteralContextVersion, dryRunImmutableMutations, hasXnlLiteralContext, needsXnlLiteralBinding } from '../src/index';

const rules = captureImmutableData({ literalAttributeRules: [{ tags: ['ComponentEmbed', 'CapsuleEmbed'], attributes: ['input'] }] });
const word = (name: string) => ({ kind: 'Word', namespace: [], name });
function document(input?: unknown, tag = 'ComponentEmbed'): any {
  return captureImmutableData({ kind: 'DataElement', tag: 'Document', id: word('doc'), metadata: {}, body: [
    { kind: 'DataElement', tag, id: word('embed'), metadata: {}, ...(input === undefined ? {} : { attributes: { input } }) },
  ] });
}

describe('read-only literal binding requirement', () => {
  for (const tag of ['ComponentEmbed', 'CapsuleEmbed']) it(`queries unbound ${tag} payload without marking input`, () => {
    const root = document({ kind: 'DataElement', tag: 'Paragraph', id: word('embed'), metadata: {} }, tag);
    const epoch = capturedLiteralContextVersion();
    expect(hasXnlLiteralContext(root)).toBe(false);
    expect(needsXnlLiteralBinding(root, rules)).toBe(true);
    expect(hasXnlLiteralContext(root)).toBe(false);
    expect(capturedLiteralContextVersion()).toBe(epoch);
  });

  it('keeps rule-specific absence facts separate when rules switch', () => {
    const root = document({ message: 'business data' }), none = captureImmutableData({ literalAttributeRules: [] });
    for (let round = 0; round < 3; round++) {
      expect(needsXnlLiteralBinding(root, rules)).toBe(true);
      expect(needsXnlLiteralBinding(root, none)).toBe(false);
    }
    expect(hasXnlLiteralContext(root)).toBe(false);
  });

  it('queries explicit root-relative paths without adding syntax context', () => {
    const root = document({ ordinary: true });
    const epoch = capturedLiteralContextVersion();
    expect(needsXnlLiteralBinding(root, { literalValuePaths: ["#embed:attributes::'input'"] })).toBe(true);
    expect(hasXnlLiteralContext(root)).toBe(false);
    expect(capturedLiteralContextVersion()).toBe(epoch);
  });

  it('does not grant identity validity or hide existing context', () => {
    const root = document({ kind: 'DataElement', tag: 'Paragraph', id: word('embed'), metadata: {} });
    expect(needsXnlLiteralBinding(root)).toBe(false);
    expect(dryRunImmutableMutations(root, []).status).toBe('rejected');
    applyMutations(root, [], rules);
    expect(hasXnlLiteralContext(root)).toBe(true);
    const epoch = capturedLiteralContextVersion();
    expect(needsXnlLiteralBinding(root, rules)).toBe(true);
    expect(capturedLiteralContextVersion()).toBe(epoch);
  });

  it('re-reads raw getters instead of reusing a captured-data absence fact', () => {
    let input: unknown = 'scalar', reads = 0;
    const raw: any = { kind: 'DataElement', tag: 'ComponentEmbed', metadata: {}, attributes: { get input() { reads++; return input; } } };
    expect(needsXnlLiteralBinding(raw, rules)).toBe(false);
    input = { ordinary: true };
    expect(needsXnlLiteralBinding(raw, rules)).toBe(true);
    expect(reads).toBeGreaterThan(1);
  });
});
