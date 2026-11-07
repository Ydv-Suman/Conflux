import { InvalidUpdate, validate, importHistory } from './validate.mjs';

// One bounded request per process; Java supplies the deadline and process heap limit.
const MAX_REQUEST = Math.ceil(32 * 1024 * 1024 / 3) * 4 + 100_000;
let size = 0;
const chunks = [];
try {
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > MAX_REQUEST) throw new InvalidUpdate('SIZE_LIMIT');
    chunks.push(chunk);
  }
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const result = request?.history ? importHistory(request) : validate(request);
  process.stdout.write(JSON.stringify({ ok: true, result }));
} catch (error) {
  // Never echo document text, input JSON, or exception stacks across the boundary.
  process.stdout.write(JSON.stringify({ ok: false, code: error instanceof InvalidUpdate ? error.code : 'INVALID_REQUEST' }));
}
