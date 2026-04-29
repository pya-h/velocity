import '../src/core/metadata';
import { Suite, Test, BeforeEach, expect } from '../src/testing/decorators';
import * as Joi from 'joi';
import { Validator, Validate } from '../src/validation/validator';
import { TestUtils } from '../src/testing/test-utils';
import { VeloApplication } from '../src/core/application';
import { Controller } from '../src/decorators/controller';
import { Post } from '../src/decorators/route';

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

// ─── @Validate decorator (through pipeline) ─────────────────────────────────

@Suite('@Validate decorator')
class ValidateDecoratorTests {
  private app!: VeloApplication;

  @BeforeEach
  setup() {
    this.app = TestUtils.createTestApp();
  }

  @Test('returns 400 on invalid body')
  async rejects() {
    @Controller('/val-reject')
    class Ctrl {
      @Post('/')
      @Validate(Validator.createSchema({ name: Joi.string().required() }))
      async create(req: any, res: any) {
        return res.status(201).json({ ok: true });
      }
    }
    this.app.register(Ctrl);

    const { status, body } = await TestUtils.makeRequest(this.app, {
      method: 'POST',
      path: '/val-reject',
      body: { wrong: 'field' },
    });
    expect(status).toBe(400);
    expect(body.error).toBe('Validation failed');
  }

  @Test('passes validated body to handler on success')
  async passes() {
    let receivedName: any;

    @Controller('/val-pass')
    class Ctrl {
      @Post('/')
      @Validate(Validator.createSchema({ name: Joi.string().required() }))
      async create(req: any, res: any) {
        receivedName = req.body.name;
        return res.status(201).json({ ok: true });
      }
    }
    this.app.register(Ctrl);

    const { status } = await TestUtils.makeRequest(this.app, {
      method: 'POST',
      path: '/val-pass',
      body: { name: 'Alice' },
    });
    expect(status).toBe(201);
    expect(receivedName).toBe('Alice');
  }
}
