const SERVICE_METADATA_KEY = Symbol.for('service');

/**
 * Marks a class as a service for dependency injection.
 *
 * @param name  Optional name for DI resolution. Defaults to the class name.
 *
 * @example
 *   @Service()
 *   class UserService { ... }
 *   app.register(UserService);
 *
 *   // Register on specific controller(s):
 *   @Service()
 *   class AuthService { ... }
 *   app.register(AuthService);
 */
export function Service(name?: string) {
  return function <T extends { new (...args: any[]): {} }>(constructor: T) {
    Reflect.defineMetadata(SERVICE_METADATA_KEY, { name: name || constructor.name }, constructor);
    return constructor;
  };
}
