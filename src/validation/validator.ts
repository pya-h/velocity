import * as Joi from 'joi';
import type { RouteMetadata } from '../types';

const ROUTES_METADATA_KEY = Symbol.for('routes');
const PENDING_SCHEMA_KEY = Symbol.for('pending_schema');

export { PENDING_SCHEMA_KEY };

/**
 * A compiled validator function: takes data, returns `{ error?, value? }`.
 * Compiled once per route at startup — zero overhead per-request.
 */
export type CompiledValidator = (data: unknown) => { error?: string; value?: unknown };

/**
 * Anything accepted by @Validate:
 *   - Joi schema       (has .validate())
 *   - Zod schema       (has .safeParse())
 *   - Yup schema       (has .validateSync())
 *   - Plain function   (data => validated data, throws on error)
 *   - Any { validate } (duck-typed — Joi/Yup compatible)
 */
export type ValidateSchema =
  | Joi.ObjectSchema
  | { safeParse: (data: unknown) => { success: boolean; data?: unknown; error?: { message?: string; issues?: { message: string }[] } } }
  | { validateSync: (data: unknown, opts?: unknown) => unknown }
  | { validate: (data: unknown, opts?: unknown) => { error?: { details?: { message: string }[] }; value?: unknown } }
  | ((data: unknown) => unknown);

/**
 * Compiles any supported schema into a uniform validator function.
 * Called once per route at `listen()` time — never per-request.
 */
export function compileValidator(schema: ValidateSchema): CompiledValidator {
  // Plain function: call it, catch errors
  if (typeof schema === 'function') {
    return (data) => {
      try {
        const value = schema(data);
        return { value };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    };
  }

  // Zod-like: has .safeParse()
  if ('safeParse' in schema && typeof schema.safeParse === 'function') {
    return (data) => {
      const result = schema.safeParse(data);
      if (result.success) return { value: result.data };
      const msg = result.error?.issues?.map((i: { message: string }) => i.message).join(', ')
        ?? result.error?.message
        ?? 'Validation failed';
      return { error: msg };
    };
  }

  // Yup-like: has .validateSync() but NOT .safeParse
  if ('validateSync' in schema && typeof schema.validateSync === 'function') {
    return (data) => {
      try {
        const value = schema.validateSync(data, { abortEarly: false });
        return { value };
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    };
  }

  // Joi-like / duck-typed: has .validate()
  if ('validate' in schema && typeof schema.validate === 'function') {
    return (data) => {
      const { error, value } = schema.validate(data, { abortEarly: false });
      if (error) {
        const msg = error.details?.map((d: { message: string }) => d.message).join(', ')
          ?? String(error);
        return { error: msg };
      }
      return { value };
    };
  }

  // Fallback: treat as no-op (should never reach here with correct typing)
  return (data) => ({ value: data });
}

export class Validator {
  public static validate<T>(schema: Joi.ObjectSchema<T>, data: unknown): { error?: string; value?: T } {
    const { error, value } = schema.validate(data, { abortEarly: false });

    if (error) {
      const errorMessage = error.details.map((detail: { message: string }) => detail.message).join(', ');
      return { error: errorMessage };
    }

    return { value };
  }

  public static createSchema(definition: Joi.PartialSchemaMap): Joi.ObjectSchema {
    return Joi.object(definition);
  }

  public static readonly schemas = {
    email: Joi.string().email(),
    password: Joi.string().min(8).pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#\\$%\\^&\\*])')),
    id: Joi.number().integer().positive(),
    string: Joi.string(),
    number: Joi.number(),
    boolean: Joi.boolean(),
    date: Joi.date(),
    array: Joi.array(),
    object: Joi.object(),
  };
}

export function Validate(schema: ValidateSchema) {
  return function (target: unknown, propertyKey: string, descriptor?: PropertyDescriptor) {
    const ctor = (target as { constructor: Function }).constructor;
    const routes: RouteMetadata[] = Reflect.getMetadata(ROUTES_METADATA_KEY, ctor) || [];
    const route = routes.find(r => r.handler === propertyKey);

    if (route) {
      route.schema = schema;
    } else {
      const pending: Map<string, unknown> =
        Reflect.getMetadata(PENDING_SCHEMA_KEY, ctor) || new Map();
      pending.set(propertyKey, schema);
      Reflect.defineMetadata(PENDING_SCHEMA_KEY, pending, ctor);
    }

    return descriptor;
  };
}
