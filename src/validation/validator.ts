import * as Joi from 'joi';
import type { RouteMetadata } from '../types';

const ROUTES_METADATA_KEY = Symbol.for('routes');
const PENDING_SCHEMA_KEY = Symbol.for('pending_schema');

export { PENDING_SCHEMA_KEY };

export class Validator {
  public static validate<T>(schema: Joi.ObjectSchema<T>, data: any): { error?: string; value?: T } {
    const { error, value } = schema.validate(data, { abortEarly: false });

    if (error) {
      const errorMessage = error.details.map((detail: any) => detail.message).join(', ');
      return { error: errorMessage };
    }

    return { value };
  }

  public static createSchema(definition: any): Joi.ObjectSchema {
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

export function Validate(schema: Joi.ObjectSchema) {
  return function (target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    const routes: RouteMetadata[] = Reflect.getMetadata(ROUTES_METADATA_KEY, target.constructor) || [];
    const route = routes.find(r => r.handler === propertyKey);

    if (route) {
      route.schema = schema;
    } else {
      const pending: Map<string, any> =
        Reflect.getMetadata(PENDING_SCHEMA_KEY, target.constructor) || new Map();
      pending.set(propertyKey, schema);
      Reflect.defineMetadata(PENDING_SCHEMA_KEY, pending, target.constructor);
    }

    return descriptor;
  };
}
