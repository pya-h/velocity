import '../src/core/metadata';
import { Suite, Test, BeforeEach, expect } from '../src/testing/decorators';
import { Container } from '../src/core/container';
import { Service } from '../src/decorators/service';

@Suite('DI Container')
class ContainerTests {
  private container!: Container;

  @BeforeEach
  setup() {
    this.container = new Container();
  }

  // ─── Basic resolution ───

  @Test('resolves a registered instance')
  resolveInstance() {
    const obj = { hello: 'world' };
    this.container.register('greeting', obj);
    expect(this.container.resolve('greeting') as unknown).toBe(obj);
  }

  @Test('resolves a registered class as singleton by default')
  defaultSingleton() {
    class Svc {}
    this.container.register(Svc, Svc);
    const a = this.container.resolve<Svc>(Svc);
    const b = this.container.resolve<Svc>(Svc);
    expect(a).toBe(b);
  }

  @Test('transient registration creates new instance each resolve')
  transient() {
    class Svc {}
    this.container.register(Svc, Svc, false);
    const a = this.container.resolve<Svc>(Svc);
    const b = this.container.resolve<Svc>(Svc);
    expect(a).not.toBe(b);
  }

  @Test('resolves arrow-function factory (stateful)')
  factoryFunction() {
    let n = 0;
    // Arrow functions have no .prototype → treated as factory
    this.container.register('counter', (() => ({ n: ++n })) as any, false);
    const first  = this.container.resolve<{ n: number }>('counter');
    const second = this.container.resolve<{ n: number }>('counter');
    expect(first.n).toBe(1);
    expect(second.n).toBe(2);
  }

  @Test('singleton factory is called only once')
  singletonFactory() {
    let calls = 0;
    this.container.register('once', (() => ({ calls: ++calls })) as any, true);
    this.container.resolve('once');
    this.container.resolve('once');
    expect(calls).toBe(1);
  }

  // ─── Constructor injection ───

  @Test('injects constructor dependencies via design:paramtypes')
  constructorInjection() {
    @Service()
    class Logger { log() {} }

    @Service()
    class UserService { constructor(public logger: Logger) {} }

    Reflect.defineMetadata('design:paramtypes', [Logger], UserService);

    this.container.register(Logger, Logger);
    this.container.register(UserService, UserService);

    const svc = this.container.resolve<UserService>(UserService);
    expect(svc.logger).toBeInstanceOf(Logger);
  }

  // ─── Circular dependency detection ───

  @Test('throws on circular dependency')
  circularDep() {
    class B { constructor(_a: any) {} }
    class A { constructor(_b: B) {} }
    Reflect.defineMetadata('design:paramtypes', [B], A);
    Reflect.defineMetadata('design:paramtypes', [A], B);

    this.container.register(A, A);
    this.container.register(B, B);

    expect(() => this.container.resolve(A)).toThrow(/circular/i);
  }

  // ─── Child containers ───

  @Test('child resolves services from parent')
  childInheritsParent() {
    this.container.register('shared', 'from-parent');
    const child = this.container.createChild();
    expect(child.resolve('shared') as unknown).toBe('from-parent');
  }

  @Test('child can override parent services locally')
  childOverride() {
    this.container.register('key', 'parent');
    const child = this.container.createChild();
    child.register('key', 'child');
    expect(child.resolve('key') as unknown).toBe('child');
    expect(this.container.resolve('key') as unknown).toBe('parent');
  }

  // ─── has() ───

  @Test('has() returns true for registered identifier')
  hasRegistered() {
    this.container.register('x', 99);
    expect(this.container.has('x')).toBe(true);
  }

  @Test('has() returns false for unknown identifier')
  hasUnknown() {
    expect(this.container.has('nope')).toBe(false);
  }

  @Test('has() checks parent chain')
  hasParentChain() {
    this.container.register('shared', 1);
    const child = this.container.createChild();
    expect(child.has('shared')).toBe(true);
  }

  // ─── Throws when missing ───

  @Test('throws when resolving unknown string identifier')
  resolveUnknown() {
    expect(() => this.container.resolve('missing')).toThrow(/not found/);
  }
}
