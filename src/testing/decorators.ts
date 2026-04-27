import '../core/metadata';
import { describe, test, beforeEach, afterEach, beforeAll, afterAll, expect, mock } from 'bun:test';

export { expect, mock };

// ─── Internal metadata keys ───

const SUITE_TESTS_KEY = Symbol('velocity:suite:tests');
const BEFORE_EACH_KEY = Symbol('velocity:suite:beforeEach');
const AFTER_EACH_KEY  = Symbol('velocity:suite:afterEach');
const BEFORE_ALL_KEY  = Symbol('velocity:suite:beforeAll');
const AFTER_ALL_KEY   = Symbol('velocity:suite:afterAll');
const MOCK_PROPS_KEY  = Symbol('velocity:suite:mocks');

interface TestDef { name: string; method: string; }

// ─── @Suite ───

/**
 * Marks a class as a test suite. Registers a `describe()` block containing all
 * `@Test`-decorated methods. Lifecycle hooks and `@Mock` properties are wired
 * automatically — no manual `describe/beforeEach/test` boilerplate needed.
 *
 * One instance is created per suite (shared state). `@Mock` properties are
 * refreshed (factory re-called) before each test, then `@BeforeEach` runs.
 *
 * @example
 *   @Suite('User service')
 *   class UserServiceTests {
 *     @Mock(() => mock(() => []))
 *     private queryFn: ReturnType<typeof mock>;
 *
 *     @BeforeEach
 *     setup() { this.service = new UserService(this.queryFn); }
 *
 *     @Test('returns empty list')
 *     async empty() {
 *       expect(await this.service.list()).toEqual([]);
 *     }
 *   }
 */
export function Suite(name: string): ClassDecorator {
  return (target: any) => {
    const tests: TestDef[]  = Reflect.getMetadata(SUITE_TESTS_KEY, target) ?? [];
    const beforeEachs: string[] = Reflect.getMetadata(BEFORE_EACH_KEY, target) ?? [];
    const afterEachs: string[]  = Reflect.getMetadata(AFTER_EACH_KEY,  target) ?? [];
    const beforeAlls: string[]  = Reflect.getMetadata(BEFORE_ALL_KEY,  target) ?? [];
    const afterAlls: string[]   = Reflect.getMetadata(AFTER_ALL_KEY,   target) ?? [];
    const mocks: Map<string, () => any> = Reflect.getMetadata(MOCK_PROPS_KEY, target) ?? new Map();

    describe(name, () => {
      const instance = new target();

      // Fresh mocks applied before each test (factory re-called = clean call history)
      const applyMocks = () => { for (const [prop, factory] of mocks) instance[prop] = factory(); };
      applyMocks();

      if (beforeAlls.length > 0) {
        beforeAll(async () => { for (const m of beforeAlls) await instance[m](); });
      }

      if (afterAlls.length > 0) {
        afterAll(async () => { for (const m of afterAlls) await instance[m](); });
      }

      // Always register beforeEach so mocks are refreshed between tests
      beforeEach(async () => {
        applyMocks();
        for (const m of beforeEachs) await instance[m]();
      });

      if (afterEachs.length > 0) {
        afterEach(async () => { for (const m of afterEachs) await instance[m](); });
      }

      for (const { name: testName, method } of tests) {
        test(testName, async () => { await instance[method](); });
      }
    });
  };
}

// ─── @Test ───

/** Marks a method as a test case inside a `@Suite`. Name defaults to method name. */
export function Test(name?: string): MethodDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const ctor = target.constructor;
    const tests: TestDef[] = Reflect.getMetadata(SUITE_TESTS_KEY, ctor) ?? [];
    tests.push({ name: name ?? String(propertyKey), method: String(propertyKey) });
    Reflect.defineMetadata(SUITE_TESTS_KEY, tests, ctor);
  };
}

// ─── @Mock ───

/**
 * Initializes a class property with the value returned by `factory()`.
 * The factory is re-invoked before each `@Test`, so every test gets a fresh
 * mock with no accumulated call history.
 *
 * @example
 *   @Mock(() => mock((x: number) => x * 2))
 *   private double: ReturnType<typeof mock>;
 */
export function Mock(factory: () => any): PropertyDecorator {
  return (target: any, propertyKey: string | symbol) => {
    const ctor = target.constructor;
    const mocks: Map<string, () => any> = Reflect.getMetadata(MOCK_PROPS_KEY, ctor) ?? new Map();
    mocks.set(String(propertyKey), factory);
    Reflect.defineMetadata(MOCK_PROPS_KEY, mocks, ctor);
  };
}

// ─── Lifecycle decorators ───

function lifecycleDecorator(key: symbol) {
  return (target: any, propertyKey: string | symbol, _d: PropertyDescriptor): void => {
    const ctor = target.constructor;
    const methods: string[] = Reflect.getMetadata(key, ctor) ?? [];
    methods.push(String(propertyKey));
    Reflect.defineMetadata(key, methods, ctor);
  };
}

/** Runs before each `@Test` in the suite (after `@Mock` properties are refreshed). */
export const BeforeEach = lifecycleDecorator(BEFORE_EACH_KEY);
/** Runs after each `@Test` in the suite. */
export const AfterEach  = lifecycleDecorator(AFTER_EACH_KEY);
/** Runs once before all `@Test` cases in the suite. */
export const BeforeAll  = lifecycleDecorator(BEFORE_ALL_KEY);
/** Runs once after all `@Test` cases in the suite. */
export const AfterAll   = lifecycleDecorator(AFTER_ALL_KEY);
