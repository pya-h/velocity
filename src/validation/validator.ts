import * as Joi from 'joi';

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

  // Common validation schemas
  public static readonly schemas = {
    email: Joi.string().email(),
    password: Joi.string().min(8).pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#\$%\^&\*])')),
    id: Joi.number().integer().positive(),
    string: Joi.string(),
    number: Joi.number(),
    boolean: Joi.boolean(),
    date: Joi.date(),
    array: Joi.array(),
    object: Joi.object()
  };
}

// Validation decorator
export function Validate(schema: Joi.ObjectSchema) {
  return function (target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    if (!descriptor) return descriptor;
    
    const originalMethod = descriptor.value;

    descriptor.value = async function (req: any, res: any, ...args: any[]) {
      const { error, value } = Validator.validate(schema, req.body);
      
      if (error) {
        return res.status(400).json({ error: 'Validation failed', message: error });
      }
      
      req.body = value;
      return originalMethod.apply(this, [req, res, ...args]);
    };

    return descriptor;
  };
}
