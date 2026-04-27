import '../src/core/metadata';
import { Suite, Test, BeforeEach, expect } from '../src/testing/decorators';
import * as Joi from 'joi';
import { Validator, Validate } from '../src/validation/validator';
import { TestUtils } from '../src/testing/test-utils';

// ─── Validator class ─────────────────────────────────────────────────────────

@Suite('Validator.validate()')
class ValidatorTests {
  private schema!: Joi.ObjectSchema;

  @BeforeEach
  setup() {
    this.schema = Validator.createSchema({
      name:  Joi.string().required(),
      age:   Joi.number().integer().min(0),
      email: Joi.string().email(),
    });
  }

  @Test('valid data returns value with no error')
  validData() {
    const { value, error } = Validator.validate(this.schema, { name: 'Alice', age: 30 });
    expect(error).toBeUndefined();
    expect(value?.name).toBe('Alice');
    expect(value?.age).toBe(30);
  }

  @Test('missing required field returns error message')
  missingRequired() {
    const { error } = Validator.validate(this.schema, { age: 25 });
    expect(error).toBeDefined();
    expect(error).toContain('"name"');
  }

  @Test('invalid type returns error message')
  invalidType() {
    const { error } = Validator.validate(this.schema, { name: 'Bob', age: 'not-a-number' });
    expect(error).toBeDefined();
    expect(error).toContain('"age"');
  }

  @Test('invalid email returns error message')
  invalidEmail() {
    const { error } = Validator.validate(this.schema, { name: 'Bob', email: 'not-an-email' });
    expect(error).toBeDefined();
    expect(error).toContain('"email"');
  }

  @Test('multiple errors are joined with comma')
  multipleErrors() {
    const { error } = Validator.validate(this.schema, { age: -1, email: 'bad' });
    expect(error).toBeDefined();
    expect(error!.split(', ').length).toBeGreaterThan(1);
  }
}

@Suite('Validator.schemas preset types')
class ValidatorSchemaTests {
  @Test('email schema rejects invalid address')
  emailSchema() {
    const result = Validator.schemas.email.validate('not-an-email');
    expect(result.error).toBeDefined();
  }

  @Test('email schema accepts valid address')
  emailSchemaValid() {
    const result = Validator.schemas.email.validate('user@example.com');
    expect(result.error).toBeUndefined();
  }

  @Test('id schema rejects zero')
  idSchemaRejectsZero() {
    const result = Validator.schemas.id.validate(0);
    expect(result.error).toBeDefined();
  }

  @Test('id schema accepts positive integer')
  idSchemaAccepts() {
    const result = Validator.schemas.id.validate(1);
    expect(result.error).toBeUndefined();
  }

  @Test('password schema rejects weak password')
  weakPassword() {
    const result = Validator.schemas.password.validate('password');
    expect(result.error).toBeDefined();
  }
}

// ─── @Validate decorator ─────────────────────────────────────────────────────

@Suite('@Validate decorator')
class ValidateDecoratorTests {
  private schema!: Joi.ObjectSchema;

  @BeforeEach
  setup() {
    this.schema = Validator.createSchema({ name: Joi.string().required() });
  }

  @Test('returns 400 on invalid body')
  async rejects() {
    class TestCtrl {
      @Validate(Validator.createSchema({ name: Joi.string().required() }))
      async create(req: any, res: any) {
        return res.status(201).json({ ok: true });
      }
    }

    const ctrl = new TestCtrl();
    const req  = TestUtils.createMockRequest({ body: { wrong: 'field' } });
    const res  = TestUtils.createMockResponse();

    await ctrl.create(req, res);

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Validation failed');
  }

  @Test('passes validated body to handler on success')
  async passes() {
    let handlerBody: any;

    class TestCtrl {
      @Validate(Validator.createSchema({ name: Joi.string().required() }))
      async create(req: any, res: any) {
        handlerBody = req.body;
        return res.status(201).json({ ok: true });
      }
    }

    const ctrl = new TestCtrl();
    // Use a body that exactly matches the schema (no unknown keys — Joi 18 rejects them by default)
    const req  = TestUtils.createMockRequest({ body: { name: 'Alice' } });
    const res  = TestUtils.createMockResponse();

    await ctrl.create(req, res);

    expect(res.statusCode).toBe(201);
    expect(handlerBody.name).toBe('Alice');
  }
}
