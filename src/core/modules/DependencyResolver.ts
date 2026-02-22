import type { ModuleMetadata } from '../../types/module.types.js';
import { Logger } from '../../shared/utils/logger.js';

const logger = new Logger('DependencyResolver');

/**
 * Error thrown when circular dependencies are detected
 */
export class CircularDependencyError extends Error {
  constructor(public readonly cycle: string[]) {
    super(`Circular dependency detected: ${cycle.join(' -> ')}`);
    this.name = 'CircularDependencyError';
  }
}

/**
 * Error thrown when a dependency is missing
 */
export class MissingDependencyError extends Error {
  constructor(
    public readonly moduleId: string,
    public readonly missingDependency: string
  ) {
    super(`Module "${moduleId}" depends on "${missingDependency}", which does not exist`);
    this.name = 'MissingDependencyError';
  }
}

/**
 * Result of dependency resolution
 */
export interface DependencyResolutionResult {
  /** Modules in load order (dependencies first) */
  loadOrder: string[];

  /** Map of module ID to its dependencies */
  dependencies: Map<string, string[]>;

  /** Map of module ID to modules that depend on it */
  dependents: Map<string, string[]>;
}

/**
 * Resolves module dependencies and determines load order.
 * Uses topological sort (Kahn's algorithm) for ordering.
 */
export class DependencyResolver {
  /**
   * Resolve dependencies and return load order
   * @param modules Array of module metadata
   * @returns Resolution result with load order and dependency maps
   * @throws CircularDependencyError if cycles detected
   * @throws MissingDependencyError if dependencies are missing
   */
  resolve(modules: ModuleMetadata[]): DependencyResolutionResult {
    const moduleMap = new Map(modules.map(m => [m.id, m]));
    const dependencies = new Map<string, string[]>();
    const dependents = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    // Initialize maps
    for (const module of modules) {
      dependencies.set(module.id, [...module.dependencies]);
      dependents.set(module.id, []);
      inDegree.set(module.id, 0);
    }

    // Validate dependencies exist and build graph
    for (const module of modules) {
      for (const dep of module.dependencies) {
        if (!moduleMap.has(dep)) {
          throw new MissingDependencyError(module.id, dep);
        }

        // Add to dependents map
        dependents.get(dep)!.push(module.id);

        // Increment in-degree
        inDegree.set(module.id, (inDegree.get(module.id) || 0) + 1);
      }
    }

    // Kahn's algorithm for topological sort
    // Start with modules that have no dependencies (in-degree 0)
    const queue: string[] = [];

    for (const [moduleId, degree] of inDegree) {
      if (degree === 0) {
        queue.push(moduleId);
      }
    }

    // Sort queue by priority (higher priority first)
    queue.sort((a, b) => {
      const moduleA = moduleMap.get(a)!;
      const moduleB = moduleMap.get(b)!;
      return moduleB.priority - moduleA.priority;
    });

    const loadOrder: string[] = [];

    while (queue.length > 0) {
      const current = queue.shift()!;
      loadOrder.push(current);

      // Process dependents
      for (const dependent of dependents.get(current)!) {
        const newDegree = inDegree.get(dependent)! - 1;
        inDegree.set(dependent, newDegree);

        if (newDegree === 0) {
          queue.push(dependent);
          // Re-sort by priority
          queue.sort((a, b) => {
            const moduleA = moduleMap.get(a)!;
            const moduleB = moduleMap.get(b)!;
            return moduleB.priority - moduleA.priority;
          });
        }
      }
    }

    // Check for cycles (if not all modules processed)
    if (loadOrder.length !== modules.length) {
      const cycle = this.findCycle(modules, dependencies);
      throw new CircularDependencyError(cycle);
    }

    logger.debug(`Resolved load order: ${loadOrder.join(' -> ')}`);

    return {
      loadOrder,
      dependencies,
      dependents,
    };
  }

  /**
   * Find a cycle in the dependency graph (for error reporting)
   */
  private findCycle(
    modules: ModuleMetadata[],
    dependencies: Map<string, string[]>
  ): string[] {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const path: string[] = [];

    const dfs = (moduleId: string): boolean => {
      visited.add(moduleId);
      recursionStack.add(moduleId);
      path.push(moduleId);

      for (const dep of dependencies.get(moduleId) || []) {
        if (!visited.has(dep)) {
          if (dfs(dep)) return true;
        } else if (recursionStack.has(dep)) {
          // Found cycle - extract it from path
          const cycleStart = path.indexOf(dep);
          path.push(dep); // Complete the cycle
          return true;
        }
      }

      path.pop();
      recursionStack.delete(moduleId);
      return false;
    };

    for (const module of modules) {
      if (!visited.has(module.id)) {
        if (dfs(module.id)) {
          return path;
        }
      }
    }

    return ['Unknown cycle'];
  }

  /**
   * Check if all dependencies of a module are satisfied
   */
  checkDependencies(
    moduleId: string,
    moduleDependencies: string[],
    loadedModules: Set<string>
  ): { satisfied: boolean; missing: string[] } {
    const missing: string[] = [];

    for (const dep of moduleDependencies) {
      if (!loadedModules.has(dep)) {
        missing.push(dep);
      }
    }

    return {
      satisfied: missing.length === 0,
      missing,
    };
  }

  /**
   * Get modules that would be affected by unloading a module
   * (i.e., modules that depend on the given module)
   */
  getAffectedModules(
    moduleId: string,
    dependents: Map<string, string[]>
  ): string[] {
    const affected = new Set<string>();
    const queue = [moduleId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const deps = dependents.get(current) || [];

      for (const dep of deps) {
        if (!affected.has(dep)) {
          affected.add(dep);
          queue.push(dep);
        }
      }
    }

    return Array.from(affected);
  }
}

/**
 * Singleton instance
 */
export const dependencyResolver = new DependencyResolver();
