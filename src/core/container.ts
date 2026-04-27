type Constructor<T = {}> = new (...args: any[]) => T;
type ServiceIdentifier = string | symbol | Constructor;

interface ServiceDefinition {
  instance?: any;
  factory?: () => any;
  constructor?: Constructor<any>;
  singleton?: boolean;
}

export class Container {
  private services = new Map<ServiceIdentifier, ServiceDefinition>();
  private instances = new Map<ServiceIdentifier, any>();
  private resolving = new Set<any>();
  private parent?: Container;

  constructor(parent?: Container) {
    this.parent = parent;
  }

  public register<T>(identifier: ServiceIdentifier, serviceOrFactory: T | Constructor<T> | (() => T), singleton = true): void {
    if (typeof serviceOrFactory === 'function') {
      if (serviceOrFactory.prototype) {
        // Constructor function
        this.services.set(identifier, {
          constructor: serviceOrFactory as Constructor<any>,
          singleton
        });
      } else {
        // Factory function
        this.services.set(identifier, {
          factory: serviceOrFactory as () => T,
          singleton,
          constructor: undefined
        });
      }
    } else {
      // Instance
      this.services.set(identifier, {
        instance: serviceOrFactory,
        singleton: true,
        constructor: undefined
      });
    }
  }

  public resolve<T>(identifier: ServiceIdentifier): T {
    if (this.instances.has(identifier)) {
      return this.instances.get(identifier);
    }

    if (this.resolving.has(identifier)) {
      const name = typeof identifier === 'function' ? identifier.name : String(identifier);
      throw new Error(`Circular dependency detected while resolving: ${name}`);
    }

    const service = this.services.get(identifier);

    if (!service) {
      if (this.parent) {
        return this.parent.resolve(identifier);
      }
      if (typeof identifier === 'function') {
        return this.createInstance(identifier as Constructor<T>);
      }
      throw new Error(`Service ${String(identifier)} not found`);
    }

    let instance: T;

    if (service.instance !== undefined) {
      instance = service.instance;
    } else if (service.factory) {
      instance = service.factory();
    } else if (service.constructor) {
      instance = this.createInstance(service.constructor as Constructor<T>);
    } else {
      throw new Error(`Invalid service definition for ${String(identifier)}`);
    }

    if (service.singleton) {
      this.instances.set(identifier, instance);
    }

    return instance;
  }

  private createInstance<T>(constructor: Constructor<T>): T {
    this.resolving.add(constructor);

    try {
      const paramTypes = Reflect.getMetadata('design:paramtypes', constructor) || [];

      const dependencies = paramTypes.map((type: any) => {
        try {
          return this.resolve(type);
        } catch (error) {
          // Attempt to auto-create unregistered constructor dependencies
          if (typeof type === 'function' && error instanceof Error && error.message.includes('not found')) {
            return this.createInstance(type);
          }
          throw error;
        }
      });

      return new constructor(...dependencies);
    } finally {
      this.resolving.delete(constructor);
    }
  }

  public has(identifier: ServiceIdentifier): boolean {
    if (this.services.has(identifier) || this.instances.has(identifier)) {
      return true;
    }
    return this.parent ? this.parent.has(identifier) : false;
  }

  public createChild(): Container {
    return new Container(this);
  }

  public clear(): void {
    this.services.clear();
    this.instances.clear();
    this.resolving.clear();
  }
}
