export const FN_METADATA_KEY = Symbol.for('velocity:fn');

export interface FnDef {
  /** Actual method name on the class. */
  method: string;
  /** URL-visible name (defaults to method name). */
  name: string;
}

/**
 * Marks a controller method as an HTTP-callable function.
 *
 * The method becomes available at:  GET /.functionName(arg1,arg2,...)
 * All arguments are parsed from the URL — no req/res, just plain values.
 *
 * Supported arg types: number, boolean, null, "quoted string", 'quoted string', unquoted string
 *
 * @example
 *   @Fn()
 *   async getUser(id: number) {
 *     return db.User.findById(id);
 *   }
 *   // called as: GET /.getUser(1)
 *
 * @example
 *   @Fn('search')
 *   async searchUsers(query: string, limit: number) { ... }
 *   // called as: GET /.search("alice",10)
 */
export function Fn(name?: string): MethodDecorator {
  return (target, propertyKey) => {
    const methodName = String(propertyKey);
    const ctor = (target as any).constructor;
    const defs: FnDef[] = Reflect.getMetadata(FN_METADATA_KEY, ctor) ?? [];
    defs.push({ method: methodName, name: name ?? methodName });
    Reflect.defineMetadata(FN_METADATA_KEY, defs, ctor);
  };
}

/**
 * Parses a function call path like `/.name(arg1,arg2)` into name + raw args string.
 * Returns null if the path does not match the `/.name(...)` pattern.
 */
export function parseFunctionCall(rawPathname: string): { name: string; rawArgs: string } | null {
  let pathname: string;
  try {
    pathname = decodeURIComponent(rawPathname);
  } catch {
    return null;
  }

  // Match: /.name or /.name() or /.name(anything)
  const match = pathname.match(/^\/\.([A-Za-z_$][A-Za-z0-9_$]*)(?:\((.*)\))?$/);
  if (!match) return null;

  return { name: match[1], rawArgs: match[2] ?? '' };
}

/**
 * Parses the argument list string from a function call URL.
 *
 * Handles:
 *   - Quoted strings:   "hello, world"  or  'it\'s fine'
 *   - Numbers:          42  -3.14  1e10
 *   - Booleans:         true  false
 *   - Null:             null
 *   - Unquoted strings: hello  (everything else)
 */
export function parseFnArgs(argsStr: string): any[] {
  const result: any[] = [];
  let i = 0;
  const s = argsStr;
  const n = s.length;

  const skipWs = () => { while (i < n && (s[i] === ' ' || s[i] === '\t')) i++; };

  while (i < n) {
    skipWs();
    if (i >= n) break;

    let value: any;

    if (s[i] === '"' || s[i] === "'") {
      const q = s[i++];
      let str = '';
      while (i < n && s[i] !== q) {
        if (s[i] === '\\' && i + 1 < n) {
          i++;
          const c = s[i];
          str += c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c;
        } else {
          str += s[i];
        }
        i++;
      }
      if (i < n) i++; // skip closing quote
      value = str;
    } else {
      // Read until comma
      let token = '';
      while (i < n && s[i] !== ',') token += s[i++];
      token = token.trim();

      if (token === '') { if (i < n && s[i] === ',') i++; continue; }

      if      (token === 'true')      value = true;
      else if (token === 'false')     value = false;
      else if (token === 'null')      value = null;
      else if (token === 'undefined') value = undefined;
      else if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(token)) value = Number(token);
      else value = token;
    }

    result.push(value);

    skipWs();
    if (i < n && s[i] === ',') i++;
  }

  return result;
}
