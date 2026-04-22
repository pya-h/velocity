import * as fs from 'fs';
import * as path from 'path';

/**
 * Convert an ENV_VAR_NAME segment to camelCase.
 * Preserves leading underscores: _SECOND → _second
 */
function toCamelCase(segment: string): string {
  let leading = '';
  let rest = segment;
  while (rest.startsWith('_')) {
    leading += '_';
    rest = rest.slice(1);
  }
  if (!rest) return leading;

  const parts = rest.split('_').filter(Boolean);
  const camel = parts.map((p, i) => {
    const lower = p.toLowerCase();
    return i === 0 ? lower : lower[0].toUpperCase() + lower.slice(1);
  }).join('');

  return leading + camel;
}

/**
 * Minimal .env parser. Handles comments, quotes, empty lines, `export` prefix.
 * Does not require dotenv.
 */
function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};

  const result: Record<string, string> = {};
  const content = fs.readFileSync(filePath, 'utf-8');

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const cleaned = trimmed.startsWith('export ') ? trimmed.slice(7) : trimmed;
    const eqIndex = cleaned.indexOf('=');
    if (eqIndex === -1) continue;

    const key = cleaned.slice(0, eqIndex).trim();
    let value = cleaned.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    result[key] = value;
  }

  return result;
}

/**
 * Build a nested tree from flat env key-value pairs.
 *
 * Naming rules:
 * - Single underscore (_) → camelCase word boundary: ENV_FIELD → envField
 * - Double underscore (__) → nesting separator: A__B → { a: { b: value } }
 * - Triple underscore (___) → nesting + leading underscore: A___B → { a: { _b: value } }
 *
 * Conflict resolution:
 * If A__B has a value AND A__B__C also exists, B becomes { default: value, c: ... }
 */
function buildTree(flat: Record<string, string>): Record<string, any> {
  const tree: Record<string, any> = {};

  // Sort keys so shorter paths are processed first (leaf before branch conflicts handled correctly)
  const sortedKeys = Object.keys(flat).sort((a, b) => a.split('__').length - b.split('__').length);

  for (const key of sortedKeys) {
    const value = flat[key];
    const segments = key.split('__').filter(Boolean);
    const pathParts = segments.map(toCamelCase);

    let current = tree;
    for (let i = 0; i < pathParts.length - 1; i++) {
      const seg = pathParts[i];
      if (typeof current[seg] === 'string') {
        // Conflict: was a leaf, now needs to be a branch — promote value to 'default'
        current[seg] = { default: current[seg] };
      }
      if (!current[seg] || typeof current[seg] !== 'object') {
        current[seg] = {};
      }
      current = current[seg];
    }

    const leaf = pathParts[pathParts.length - 1];
    if (typeof current[leaf] === 'object' && current[leaf] !== null) {
      // Already a branch — this value becomes 'default'
      current[leaf].default = value;
    } else {
      current[leaf] = value;
    }
  }

  return tree;
}

/**
 * Recursively wrap an object with a Proxy that:
 * - Provides `keyOrThrow` getters that throw if the value is undefined
 * - Prevents mutation (all setters throw)
 * - Recursively wraps nested objects
 */
function freeze(obj: Record<string, any>): any {
  const wrapped: Record<string, any> = {};

  for (const [key, value] of Object.entries(obj)) {
    wrapped[key] = (typeof value === 'object' && value !== null)
      ? freeze(value)
      : value;
  }

  return new Proxy(wrapped, {
    get(target, prop: string | symbol) {
      if (typeof prop === 'symbol') return target[prop as any];

      if (prop.endsWith('OrThrow')) {
        const realKey = prop.slice(0, -7);
        const val = target[realKey];
        if (val === undefined || val === null) {
          throw new Error(`Required env config "${realKey}" is not set`);
        }
        return val;
      }

      return target[prop];
    },
    set(_target, prop) {
      throw new Error(`Cannot set envelocity property "${String(prop)}" — config is read-only`);
    },
    deleteProperty(_target, prop) {
      throw new Error(`Cannot delete envelocity property "${String(prop)}" — config is read-only`);
    }
  });
}

export interface EnvelocityOptions {
  /** Path to .env file. Variables are loaded into process.env (won't override existing vars). */
  envFile?: string;
  /** Only include these specific env var keys. If omitted, reads all of process.env. */
  keys?: string[];
  /** Provide a custom env object instead of process.env. */
  env?: Record<string, string>;
}

/**
 * Create an envelocity config object — a nested, read-only, typed wrapper around env vars.
 *
 * Naming:
 *   ENV_FIELD         → envelocity.envField
 *   ENV_A__B          → envelocity.envA.b
 *   ENV_A__B__C       → envelocity.envA.b.c
 *   ENV_A___B         → envelocity.envA._b
 *
 * Access:
 *   envelocity.field           — returns value or undefined
 *   envelocity.fieldOrThrow    — returns value or throws
 *
 * All properties are read-only (assignment throws).
 */
export function createEnvelocity(options: EnvelocityOptions = {}): any {
  // Load .env file if specified (does not override existing vars)
  if (options.envFile) {
    const resolved = path.isAbsolute(options.envFile)
      ? options.envFile
      : path.resolve(process.cwd(), options.envFile);

    const envVars = parseEnvFile(resolved);
    for (const [key, value] of Object.entries(envVars)) {
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
  }

  let source: Record<string, string>;
  if (options.env) {
    source = options.env;
  } else if (options.keys) {
    // Only read specified keys from process.env
    source = {};
    for (const key of options.keys) {
      if (process.env[key] !== undefined) {
        source[key] = process.env[key]!;
      }
    }
  } else {
    source = process.env as Record<string, string>;
  }

  const tree = buildTree(source);
  return freeze(tree);
}
