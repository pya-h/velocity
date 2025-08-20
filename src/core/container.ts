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
    // Check if instance already exists for singletons
    if (this.instances.has(identifier)) {
      return this.instances.get(identifier);
    }

    const service = this.services.get(identifier);

    if (!service) {
      // Try to resolve as constructor
      if (typeof identifier === 'function') {
        return this.createInstance(identifier as Constructor<T>);
      }
      throw new Error(`Service ${String(identifier)} not found`);
    }

    let instance: T;

    if (service.instance) {
      instance = service.instance;
    } else if (service.factory) {
      instance = service.factory();
    } else if (service.constructor) {
      instance = this.createInstance(service.constructor as Constructor<T>);
    } else {
      throw new Error(`Invalid service definition for ${String(identifier)}`);
    }

    // Cache singleton instances
    if (service.singleton) {
      this.instances.set(identifier, instance);
    }

    return instance;
  }

  private createInstance<T>(constructor: Constructor<T>): T {
    // Get constructor parameter types
    const paramTypes = Reflect.getMetadata('design:paramtypes', constructor) || [];
    
    // Resolve dependencies
    const dependencies = paramTypes.map((type: any) => {
      try {
        return this.resolve(type);
      } catch (error) {
        // If dependency not found, try to create it
        if (typeof type === 'function') {
          return this.createInstance(type);
        }
        throw error;
      }
    });

    return new constructor(...dependencies);
  }

  public has(identifier: ServiceIdentifier): boolean {
    return this.services.has(identifier) || this.instances.has(identifier);
  }

  public clear(): void {
    this.services.clear();
    this.instances.clear();
  }
}
