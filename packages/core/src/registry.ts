import type {
  Capability,
  ProviderDescriptor,
} from "./contracts/common";
import { ProviderDescriptorSchema } from "./contracts/common";
import type { MarketDataProvider } from "./provider";
import { CAPABILITY_METHODS } from "./provider";
import { evaluateProvider, type RuntimePolicy } from "./policy";

export interface RegisteredProvider {
  provider: MarketDataProvider;
  descriptor: ProviderDescriptor;
}

export class ProviderRegistry {
  private readonly providers = new Map<string, RegisteredProvider>();

  register(provider: MarketDataProvider): void {
    const descriptor = ProviderDescriptorSchema.parse(provider.descriptor);

    if (this.providers.has(descriptor.id)) {
      throw new Error(`Provider "${descriptor.id}" is already registered`);
    }

    for (const capability of descriptor.capabilities) {
      const method = CAPABILITY_METHODS[capability];
      const fn = provider[method as keyof MarketDataProvider];
      if (typeof fn !== "function") {
        throw new Error(
          `Provider "${descriptor.id}" declares "${capability}" but does not implement "${method}"`,
        );
      }
    }

    this.providers.set(descriptor.id, { provider, descriptor });
  }

  list(): ProviderDescriptor[] {
    return [...this.providers.values()]
      .map(({ descriptor }) => descriptor)
      .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  }

  get(id: string): MarketDataProvider | undefined {
    return this.providers.get(id)?.provider;
  }

  require(id: string): MarketDataProvider {
    const provider = this.get(id);
    if (!provider) {
      throw new Error(`Provider "${id}" is not registered`);
    }
    return provider;
  }

  forCapability(
    capability: Capability,
    policy?: RuntimePolicy,
  ): MarketDataProvider[] {
    return [...this.providers.values()]
      .filter(({ descriptor }) =>
        descriptor.capabilities.includes(capability),
      )
      .filter(({ descriptor }) => {
        if (!policy) return true;
        return evaluateProvider(descriptor, policy).allowed;
      })
      .sort(
        (a, b) =>
          a.descriptor.priority - b.descriptor.priority ||
          a.descriptor.id.localeCompare(b.descriptor.id),
      )
      .map(({ provider }) => provider);
  }

  evaluations(policy: RuntimePolicy): Array<{
    descriptor: ProviderDescriptor;
    allowed: boolean;
    reasons: string[];
  }> {
    return this.list().map((descriptor) => ({
      descriptor,
      ...evaluateProvider(descriptor, policy),
    }));
  }
}
