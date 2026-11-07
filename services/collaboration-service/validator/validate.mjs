import * as Y from 'yjs';

export const MAX_BYTES = 2 * 1024 * 1024;
const MAX_UNITS = 100_000;
const MAX_STRUCTS = 10_000;
export class InvalidUpdate extends Error {
  constructor(code) { super(code); this.code = code; }
}
const requireValid = (condition, code) => { if (!condition) throw new InvalidUpdate(code); };
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const key = (id) => id === null ? null : `${id.client}:${id.clock}`;

function bytes(value) {
  requireValid(typeof value === 'string' && value.length <= Math.ceil(MAX_BYTES / 3) * 4, 'SIZE_LIMIT');
  const result = Buffer.from(value, 'base64');
  requireValid(result.length > 0 && result.length <= MAX_BYTES && result.toString('base64') === value, 'INVALID_ENCODING');
  return result;
}

function decode(update) {
  // Pinned Yjs decoder position is checked because decodeUpdate otherwise accepts trailing bytes.
  let decoder;
  class Decoder extends Y.UpdateDecoderV1 {
    constructor(input) { super(input); decoder = this; }
  }
  const result = Y.decodeUpdateV2(update, Decoder);
  requireValid(decoder.restDecoder.pos === update.length, 'TRAILING_BYTES');
  requireValid(result.structs.length <= MAX_STRUCTS, 'STRUCT_LIMIT');
  return result;
}

function index(decoded, allowDeleted = false) {
  const items = new Map();
  for (const item of decoded.structs) {
    requireValid(item instanceof Y.Item && (item.content instanceof Y.ContentString || (allowDeleted && item.content instanceof Y.ContentDeleted))
      && item.parentSub === null && (item.parent === null || item.parent === 'content'), 'UNSUPPORTED_CONTENT');
    requireValid(integer(item.id.client) && integer(item.id.clock) && integer(item.length)
      && item.length > 0 && integer(item.id.clock + item.length), 'INVALID_RANGE');
    requireValid(items.size + item.length <= MAX_UNITS, 'CONTENT_LIMIT');
    for (const anchor of [item.origin, item.rightOrigin]) {
      requireValid(anchor === null || (integer(anchor.client) && integer(anchor.clock)), 'INVALID_RANGE');
    }
    for (let offset = 0; offset < item.length; offset++) {
      const id = { client: item.id.client, clock: item.id.clock + offset };
      const identity = key(id);
      requireValid(!items.has(identity), 'DUPLICATE_STRUCT');
      items.set(identity, {
        ...id, character: item.content instanceof Y.ContentString ? item.content.str.charAt(offset) : null,
        origin: offset === 0 ? key(item.origin) : `${id.client}:${id.clock - 1}`,
        right: key(item.rightOrigin), parent: offset === 0 ? item.parent : null,
      });
    }
  }
  return items;
}

function references(items) {
  for (const item of items.values()) {
    for (const anchor of [item.origin, item.right]) {
      requireValid(anchor === null || items.has(anchor), 'MISSING_DEPENDENCY');
      requireValid(anchor !== key(item), 'INVALID_REFERENCE');
    }
    requireValid(item.parent === 'content' || item.origin !== null || item.right !== null, 'UNSUPPORTED_CONTENT');
  }
}

function deletions(decoded, items) {
  const deleted = new Set();
  let inspected = 0;
  for (const [client, ranges] of decoded.ds.clients) {
    requireValid(integer(client), 'INVALID_RANGE');
    for (const range of ranges) {
      requireValid(integer(range.clock) && integer(range.len) && range.len > 0
        && integer(range.clock + range.len), 'INVALID_RANGE');
      inspected += range.len;
      requireValid(inspected <= MAX_UNITS, 'CONTENT_LIMIT');
      for (let clock = range.clock; clock < range.clock + range.len; clock++) {
        const identity = `${client}:${clock}`;
        requireValid(items.has(identity), 'MISSING_DELETE_TARGET');
        deleted.add(identity);
      }
    }
  }
  return deleted;
}

function ranges(items) {
  const sorted = [...items].sort((a, b) => a.client - b.client || a.clock - b.clock);
  const result = [];
  for (const item of sorted) {
    const previous = result.at(-1);
    if (previous && previous.clientId === item.client && previous.clock + previous.length === item.clock) previous.length++;
    else result.push({ clientId: item.client, clock: item.clock, length: 1 });
  }
  return result;
}

/**
 * Stateless validation. baseline must be the exact durable document snapshot;
 * writerId must come from a server binding already checked against the actor.
 * A successful result is tentative until Java atomically persists it with provenance.
 */
export function validate(request) {
  let doc;
  try {
    requireValid(request !== null && typeof request === 'object' && !Array.isArray(request)
      && Object.keys(request).sort().join(',') === 'baseline,update,writerId', 'INVALID_REQUEST');
    requireValid(integer(request.writerId), 'INVALID_WRITER');
    const baseline = bytes(request.baseline), update = bytes(request.update);
    const baseDecoded = decode(baseline), incomingDecoded = decode(update);
    const known = index(baseDecoded, true), incoming = index(incomingDecoded, true);
    references(known);
    const alreadyDeleted = deletions(baseDecoded, known);
    for (const [id, item] of known) requireValid(item.character !== null || alreadyDeleted.has(id), 'UNSUPPORTED_CONTENT');
    const combined = new Map(known);
    const inserted = [];
    const clocks = new Map();
    for (const item of known.values()) clocks.set(item.client, Math.max(clocks.get(item.client) ?? 0, item.clock + 1));
    for (const [identity, item] of incoming) {
      const existing = known.get(identity);
      if (existing) {
        requireValid((existing.character === item.character || (alreadyDeleted.has(identity) && (existing.character === null || item.character === null))) && existing.origin === item.origin
          && existing.right === item.right && existing.parent === item.parent, 'CONFLICTING_STRUCT');
      } else {
        requireValid(item.character !== null, 'UNSUPPORTED_CONTENT');
        requireValid(item.client === request.writerId, 'FOREIGN_WRITER');
        requireValid(item.clock === (clocks.get(item.client) ?? 0), 'CLOCK_GAP');
        clocks.set(item.client, item.clock + 1);
        inserted.push(item);
        combined.set(identity, item);
      }
    }
    requireValid(combined.size <= MAX_UNITS, 'CONTENT_LIMIT');
    references(combined);
    const removed = deletions(incomingDecoded, combined);
    const deleted = [...removed].filter((id) => !alreadyDeleted.has(id)).map((id) => combined.get(id));
    doc = new Y.Doc({ gc: false });
    const text = doc.getText('content');
    Y.applyUpdate(doc, baseline);
    requireValid(doc.store.pendingStructs === null && doc.store.pendingDs === null, 'INCOMPLETE_BASELINE');
    const before = text.toString();
    Y.applyUpdate(doc, update);
    requireValid(doc.store.pendingStructs === null && doc.store.pendingDs === null, 'MISSING_DEPENDENCY');
    requireValid(doc.share.size === 1, 'UNSUPPORTED_CONTENT');
    const snapshot = Y.encodeStateAsUpdate(doc);
    requireValid(snapshot.length <= MAX_BYTES, 'SIZE_LIMIT');
    const integrated = index(decode(snapshot), true);
    requireValid(integrated.size === combined.size, 'INCOMPLETE_RESULT');
    for (const [identity, item] of combined) {
      // Splitting a surrogate pair must not silently mutate previously accepted text.
      requireValid(integrated.get(identity)?.character === item.character, 'UNSUPPORTED_TEXT_SPLIT');
    }
    return {
      snapshot: Buffer.from(snapshot).toString('base64'), before, after: text.toString(),
      inserted: ranges(inserted), deleted: ranges(deleted),
      changed: inserted.length > 0 || deleted.length > 0,
    };
  } catch (error) {
    if (error instanceof InvalidUpdate) throw error;
    throw new InvalidUpdate('MALFORMED_UPDATE');
  } finally { doc?.destroy(); }
}

/** Trusted server history only. No client-supplied authorship is carried across this boundary. */
export function importHistory(request) {
  let doc;
  try {
    requireValid(request && Object.keys(request).sort().join(',') === 'history', 'INVALID_REQUEST');
    requireValid(Array.isArray(request.history) && request.history.length > 0 && request.history.length <= 10000, 'INVALID_REQUEST');
    doc = new Y.Doc({ gc: false });
    const text = doc.getText('content');
    let total = 0;
    for (const encoded of request.history) {
      const update = bytes(encoded);
      total += update.length;
      requireValid(total <= 32 * 1024 * 1024, 'SIZE_LIMIT');
      decode(update);
      Y.applyUpdate(doc, update);
    }
    requireValid(doc.store.pendingStructs === null && doc.store.pendingDs === null, 'INCOMPLETE_BASELINE');
    requireValid(doc.share.size === 1, 'UNSUPPORTED_CONTENT');
    const snapshot = Y.encodeStateAsUpdate(doc);
    requireValid(snapshot.length <= MAX_BYTES, 'SIZE_LIMIT');
    const decoded = decode(snapshot), known = index(decoded, true);
    references(known);
    const deleted = deletions(decoded, known);
    for (const [id, item] of known) requireValid(item.character !== null || deleted.has(id), 'UNSUPPORTED_CONTENT');
    return { snapshot: Buffer.from(snapshot).toString('base64'), before: text.toString(), after: text.toString(),
      inserted: [], deleted: [], changed: false, importedWriters: [...new Set([...known.values()].map(item => item.client))] };
  } catch (error) {
    if (error instanceof InvalidUpdate) throw error;
    throw new InvalidUpdate('MALFORMED_UPDATE');
  } finally { doc?.destroy(); }
}
