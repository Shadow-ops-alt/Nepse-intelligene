export interface MarketDataErrorOptions {
  code: string;
  providerId?: string;
  retryable?: boolean;
  cause?: unknown;
}

export class MarketDataError extends Error {
  readonly code: string;
  readonly providerId?: string;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(message: string, options: MarketDataErrorOptions) {
    super(message);
    this.name = new.target.name;
    this.code = options.code;
    this.providerId = options.providerId;
    this.retryable = options.retryable ?? false;
    this.cause = options.cause;
  }
}

export class UnsupportedCapabilityError extends MarketDataError {
  constructor(capability: string, providerId?: string) {
    super(
      providerId
        ? `Provider "${providerId}" does not support capability "${capability}"`
        : `No provider supports capability "${capability}"`,
      { code: "UNSUPPORTED_CAPABILITY", providerId },
    );
  }
}

export class ProviderNotConfiguredError extends MarketDataError {
  constructor(providerId: string, missing: string[]) {
    super(
      `Provider "${providerId}" is not configured. Missing: ${missing.join(", ")}`,
      { code: "PROVIDER_NOT_CONFIGURED", providerId },
    );
  }
}

export class TermsRestrictionError extends MarketDataError {
  constructor(providerId: string, reasons: string[]) {
    super(
      `Provider "${providerId}" is not allowed by policy: ${reasons.join("; ")}`,
      { code: "TERMS_RESTRICTION", providerId },
    );
  }
}

export class ProviderUnavailableError extends MarketDataError {
  constructor(providerId: string, message: string, cause?: unknown) {
    super(`Provider "${providerId}" is unavailable: ${message}`, {
      code: "PROVIDER_UNAVAILABLE",
      providerId,
      retryable: true,
      cause,
    });
  }
}

export class ProviderResponseError extends MarketDataError {
  constructor(providerId: string, message: string, cause?: unknown) {
    super(`Provider "${providerId}" returned an invalid response: ${message}`, {
      code: "PROVIDER_RESPONSE_INVALID",
      providerId,
      retryable: false,
      cause,
    });
  }
}

/**
 * A file was readable but its rows failed validation. Unlike a missing file,
 * this is fatal for the whole import: partial writes would hide bad data.
 */
export class DataValidationError extends MarketDataError {
  constructor(providerId: string, message: string) {
    super(`Provider "${providerId}" rejected the import: ${message}`, {
      code: "DATA_VALIDATION",
      providerId,
      retryable: false,
    });
  }
}

export class DataQualityError extends MarketDataError {
  constructor(providerId: string, message: string) {
    super(`Provider "${providerId}" failed a data-quality guard: ${message}`, {
      code: "DATA_QUALITY",
      providerId,
    });
  }
}

export class AggregateProviderError extends MarketDataError {
  readonly errors: MarketDataError[];

  constructor(capability: string, errors: MarketDataError[]) {
    const summary = errors
      .map((error) => `${error.providerId ?? "unknown"}:${error.code}`)
      .join(", ");
    super(`All providers failed for "${capability}" (${summary})`, {
      code: "ALL_PROVIDERS_FAILED",
    });
    this.errors = errors;
  }
}
