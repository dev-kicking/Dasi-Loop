import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const installedRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const registry = 'https://registry.npmjs.org/-/package/dasi-loop/dist-tags';

function parseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(value);
  if (!match) return null;
  const pre = match[4]?.split('.') ?? [];
  if (pre.some(id => /^\d+$/.test(id) && id.length > 1 && id[0] === '0')) return null;
  return { core: match.slice(1, 4), pre };
}
const numericCompare = (a, b) => a.length === b.length ? (a === b ? 0 : a > b ? 1 : -1) : a.length > b.length ? 1 : -1;
export function compareVersions(a, b) {
  const left = parseVersion(a), right = parseVersion(b);
  if (!left || !right) return null;
  for (let i = 0; i < 3; i++) {
    const result = numericCompare(left.core[i], right.core[i]);
    if (result) return result;
  }
  if (!left.pre.length || !right.pre.length) return left.pre.length === right.pre.length ? 0 : left.pre.length ? -1 : 1;
  for (let i = 0; i < Math.max(left.pre.length, right.pre.length); i++) {
    const x = left.pre[i], y = right.pre[i];
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x), yn = /^\d+$/.test(y);
    return xn && yn ? numericCompare(x, y) : xn !== yn ? (xn ? -1 : 1) : x > y ? 1 : -1;
  }
  return 0;
}

function targetFor(metadata, skillRoot, workspace, home) {
  if (['codex', 'claude'].includes(metadata.agent) && ['user', 'project'].includes(metadata.scope)) return metadata;
  for (const agent of ['codex', 'claude']) {
    if (resolve(skillRoot) === join(home, agent === 'codex' ? '.codex' : '.claude', 'skills', 'dasi-loop')) return { agent, scope: 'user' };
    if (workspace && resolve(skillRoot) === join(resolve(workspace), agent === 'codex' ? '.agents' : '.claude', 'skills', 'dasi-loop')) return { agent, scope: 'project' };
  }
  return null;
}

// Best effort only: never mutate the saved result or install anything.
export async function updateNotice({ skillRoot = installedRoot, workspace, home = homedir(), fetchImpl = globalThis.fetch, timeoutMs = 2000 } = {}) {
  let timer;
  const controller = new AbortController();
  try {
    let metadata = {};
    try { metadata = JSON.parse(readFileSync(join(skillRoot, '.dasi-loop-install.json'), 'utf8')); } catch { /* legacy install */ }
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
    const current = metadata.version;
    if (current !== undefined && !parseVersion(current)) return null;
    const timeout = new Promise(resolveTimeout => {
      timer = setTimeout(() => { controller.abort(); resolveTimeout(null); }, timeoutMs);
    });
    const lookup = (async () => {
      const response = await fetchImpl(registry, { signal: controller.signal, redirect: 'error', headers: { accept: 'application/json' } });
      if (!response.ok) return null;
      const data = await response.json();
      return parseVersion(data?.latest) ? data.latest : null;
    })();
    const latest = await Promise.race([lookup, timeout]);
    if (!latest || (current !== undefined && compareVersions(latest, current) <= 0)) return null;
    const target = targetFor(metadata, skillRoot, workspace, home);
    const lines = [current ? `Dasi Loop update available: ${current} -> ${latest} (public npm).` : `Dasi Loop installed version unknown. Public npm latest: ${latest}; an upgrade cannot be confirmed.`];
    lines.push('Public npm package: npm update -g dasi-loop --registry=https://registry.npmjs.org/ --tag=latest');
    if (target?.scope === 'user') {
      lines.push('User-skill auto-sync requires npm install scripts. One-time approval on npm 11+: npm config set allow-scripts=dasi-loop --location=user');
      lines.push(`If npm skipped sync: dasi-loop update --agent ${target.agent} --scope user`);
    } else if (target?.scope === 'project') {
      lines.push(`Then, from the project root: dasi-loop update --agent ${target.agent} --scope project`);
    } else {
      lines.push('Skill installation target unknown: select the installed agent and scope when running dasi-loop update.');
    }
    lines.push('For GitHub/local-source installs, update from the same source before syncing the skill.');
    return lines.join('\n');
  } catch { return null; }
  finally { clearTimeout(timer); controller.abort(); }
}
