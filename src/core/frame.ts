/**
 * ResponseFrame — shapes all handler responses into a consistent structure.
 *
 * Usage:
 *   const ApiFrame = {
 *     status: Frame.Status,
 *     data:   Frame.Data,
 *     error:  Frame.Error,
 *   };
 *
 * Nested:
 *   const ApiFrame = {
 *     code:    Frame.Status,
 *     result:  { payload: Frame.Data },
 *     error:   Frame.Error,
 *     message: Frame.Extract('message'),           // required — throws if missing
 *     meta:    Frame.Extract('_meta', true),        // optional — null if missing
 *   };
 */

// ─── Sentinel symbols ────────────────────────────────────────────────────────

const FRAME_DATA    = Symbol.for('Frame.Data');
const FRAME_STATUS  = Symbol.for('Frame.Status');
const FRAME_ERROR   = Symbol.for('Frame.Error');
const FRAME_EXTRACT = Symbol.for('Frame.Extract');

interface FrameSentinel { readonly __type: symbol }
interface ExtractSentinel extends FrameSentinel {
  readonly __type: typeof FRAME_EXTRACT;
  readonly field: string;
  readonly optional: boolean;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export class Frame {
  /** Handler's return value (after interceptors). */
  static readonly Data:   FrameSentinel = { __type: FRAME_DATA };
  /** HTTP status code (number). */
  static readonly Status: FrameSentinel = { __type: FRAME_STATUS };
  /** Error message (string on throw, null on success). */
  static readonly Error:  FrameSentinel = { __type: FRAME_ERROR };

  /**
   * Extract a named field from the handler's return value.
   * The field is removed from Frame.Data and placed at this position.
   * @param field  — property name to extract from the returned object
   * @param optional — if false (default), throws 500 when the field is missing
   */
  static Extract(field: string, optional = false): ExtractSentinel {
    return { __type: FRAME_EXTRACT, field, optional };
  }
}

export type FrameTemplate = Record<string, unknown>;

// ─── Compiled frame ──────────────────────────────────────────────────────────

export interface CompiledFrame {
  /** Wrap a successful handler result. */
  success(statusCode: number, data: unknown): unknown;
  /** Wrap an error. */
  error(statusCode: number, errorMessage: string): unknown;
}

interface BuildContext {
  status: number;
  data: unknown;
  error: string | null;
  extracts: Record<string, unknown>;
}

type Builder = (ctx: BuildContext) => unknown;

/**
 * Compile a frame template into a pair of fast transform functions.
 * Runs once per template at startup — zero cost per request.
 */
export function compileFrame(template: FrameTemplate): CompiledFrame {
  const extractDefs: { field: string; optional: boolean }[] = [];

  function walk(node: unknown): Builder {
    // Check for sentinel
    if (node && typeof node === 'object' && '__type' in (node as Record<string, unknown>)) {
      const s = node as FrameSentinel;
      if (s.__type === FRAME_DATA)   return (ctx) => ctx.data;
      if (s.__type === FRAME_STATUS) return (ctx) => ctx.status;
      if (s.__type === FRAME_ERROR)  return (ctx) => ctx.error;
      if (s.__type === FRAME_EXTRACT) {
        const ext = s as ExtractSentinel;
        extractDefs.push({ field: ext.field, optional: ext.optional });
        return (ctx) => ctx.extracts[ext.field] ?? null;
      }
    }

    // Nested object — recurse
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      const entries = Object.entries(node as Record<string, unknown>);
      const builders: [string, Builder][] = entries.map(([k, v]) => [k, walk(v)]);
      return (ctx) => {
        const out: Record<string, unknown> = {};
        for (const [k, fn] of builders) out[k] = fn(ctx);
        return out;
      };
    }

    // Static literal (string, number, boolean, null)
    return () => node;
  }

  const build = walk(template);
  const hasExtracts = extractDefs.length > 0;
  const requiredExtracts = extractDefs.filter(e => !e.optional);

  return {
    success(statusCode: number, data: unknown): unknown {
      const extracts: Record<string, unknown> = {};
      let cleanData = data;

      if (hasExtracts) {
        if (data && typeof data === 'object' && !Array.isArray(data)) {
          const copy = { ...(data as Record<string, unknown>) };
          for (const ext of extractDefs) {
            if (ext.field in copy) {
              extracts[ext.field] = copy[ext.field];
              delete copy[ext.field];
            } else if (!ext.optional) {
              throw new Error(
                `ResponseFrame: required field "${ext.field}" missing from handler response`,
              );
            }
          }
          cleanData = copy;
        } else if (requiredExtracts.length > 0) {
          throw new Error(
            `ResponseFrame: required field(s) "${requiredExtracts.map(e => e.field).join(', ')}" ` +
            `missing — handler returned ${data === null ? 'null' : typeof data}, not an object`,
          );
        }
      }

      return build({ status: statusCode, data: cleanData, error: null, extracts });
    },

    error(statusCode: number, errorMessage: string): unknown {
      const extracts: Record<string, unknown> = {};
      for (const ext of extractDefs) extracts[ext.field] = null;
      return build({ status: statusCode, data: null, error: errorMessage, extracts });
    },
  };
}
