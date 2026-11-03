// Existing helper tests must never depend on the public registry.
globalThis.fetch = async () => ({ ok: false });
const preload = require('node:path').resolve(__filename);
if (!(process.env.NODE_OPTIONS || '').includes(preload)) {
  process.env.NODE_OPTIONS = `${process.env.NODE_OPTIONS || ''} --require ${JSON.stringify(preload)}`.trim();
}
