import { spawn } from "node:child_process";
import { z } from "zod";
import {
  BaseProvider,
  BrokerFlowSchema,
  CandleSchema,
  CompanySchema,
  CorporateActionSchema,
  FloorsheetTradeSchema,
  FundamentalsSnapshotSchema,
  IpoSchema,
  IndexSchema,
  MarketSummarySchema,
  NewsItemSchema,
  ProviderResponseError,
  ProviderUnavailableError,
  QuoteSchema,
  SectorPerformanceSchema,
  SectorSchema,
  SecuritySchema,
  type Capability,
  type DataEnvelope,
  type DateRange,
  type Environment,
  type ProviderDescriptor,
  type ProviderHealth,
  type Reliability,
  type RequestOptions,
  type SourceType,
  type TermsStatus,
} from "@stock/core";

const CommandResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    data: z.unknown(),
    asOf: z.string().optional(),
    warnings: z.array(z.string()).optional(),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
    code: z.string().optional(),
    retryable: z.boolean().optional(),
  }),
]);

export interface CommandProviderConfig {
  id: string;
  name: string;
  command: string;
  args?: string[];
  cwd?: string;
  timeoutMs?: number;
  capabilities: Capability[];
  sourceType?: SourceType;
  environment?: Environment;
  termsStatus?: TermsStatus;
  productionReady?: boolean;
  reliability?: Reliability;
  priority?: number;
  limits?: ProviderDescriptor["limits"];
  notes?: string;
  termsUrl?: string;
  license?: string;
}

interface CommandRequest {
  action: string;
  params?: Record<string, unknown>;
}

/**
 * Development/validation bridge for an external data tool. The repo does not
 * vendor any scraper or unlicensed asset: the operator supplies a command that
 * implements the JSON contract in docs/ARCHITECTURE.md.
 *
 * This provider defaults to sourceType=unofficial, termsStatus=unverified,
 * productionReady=false, and is therefore blocked in production by policy.
 */
export class CommandProvider extends BaseProvider {
  readonly descriptor: ProviderDescriptor;
  private readonly config: CommandProviderConfig;

  constructor(config: CommandProviderConfig) {
    super();
    this.config = config;
    this.descriptor = {
      id: config.id,
      name: config.name,
      sourceType: config.sourceType ?? "unofficial",
      environment: config.environment ?? "development",
      termsStatus: config.termsStatus ?? "unverified",
      termsUrl: config.termsUrl,
      license: config.license,
      productionReady: config.productionReady ?? false,
      reliability: config.reliability ?? "low",
      priority: config.priority ?? 900,
      capabilities: config.capabilities,
      notes:
        config.notes ??
        "External command adapter. Development/validation only unless explicitly attested.",
      configRequired: ["COMMAND_PROVIDER_CMD"],
      ...(config.limits ? { limits: config.limits } : {}),
    };
  }

  private async run<S extends z.ZodTypeAny>(
    action: string,
    params: Record<string, unknown>,
    schema: S,
    options?: RequestOptions,
  ): Promise<DataEnvelope<z.output<S>>> {
    const request: CommandRequest = { action, params };
    const timeoutMs = options?.timeoutMs ?? this.config.timeoutMs ?? 60_000;

    const child = spawn(this.config.command, this.config.args ?? [], {
      cwd: this.config.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        child.kill("SIGKILL");
      }
    }, timeoutMs);

    const abort = () => child.kill("SIGKILL");
    options?.signal?.addEventListener("abort", abort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.stdin.on("error", () => {
      // The process may exit before reading stdin; the exit code carries the
      // real error and is handled below.
    });
    child.stdin.end(JSON.stringify(request));

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => {
        settled = true;
        resolve(code);
      });
    }).finally(() => {
      clearTimeout(timeout);
      options?.signal?.removeEventListener("abort", abort);
    });

    if (options?.signal?.aborted) {
      throw new ProviderUnavailableError(
        this.descriptor.id,
        `${action} was aborted`,
      );
    }

    const out = Buffer.concat(stdout).toString("utf8").trim();
    const err = Buffer.concat(stderr).toString("utf8").trim();

    if (exitCode !== 0) {
      throw new ProviderUnavailableError(
        this.descriptor.id,
        `${action} exited with code ${exitCode}: ${err.slice(0, 500)}`,
      );
    }

    let parsed: z.infer<typeof CommandResponseSchema>;
    try {
      parsed = CommandResponseSchema.parse(JSON.parse(out));
    } catch (error) {
      throw new ProviderResponseError(
        this.descriptor.id,
        `${action} returned invalid JSON: ${out.slice(0, 300)}`,
        error,
      );
    }

    if (!parsed.ok) {
      throw new ProviderUnavailableError(
        this.descriptor.id,
        `${action} failed: ${parsed.error}`,
      );
    }

    const data = schema.safeParse(parsed.data);
    if (!data.success) {
      throw new ProviderResponseError(
        this.descriptor.id,
        `${action} returned data that does not match the contract`,
        data.error,
      );
    }

    return this.envelope(
      data.data,
      parsed.asOf ?? new Date().toISOString(),
      parsed.warnings ?? [],
    );
  }

  override async getCompanyList(options?: RequestOptions) {
    return this.run("companyList", {}, z.array(CompanySchema), options);
  }

  override async getSecurityList(options?: RequestOptions) {
    return this.run("securityList", {}, z.array(SecuritySchema), options);
  }

  override async getSectors(options?: RequestOptions) {
    return this.run("sectors", {}, z.array(SectorSchema), options);
  }

  override async getIndices(options?: RequestOptions) {
    return this.run("indices", {}, z.array(IndexSchema), options);
  }

  override async getDailyOhlc(
    symbol: string,
    range: DateRange,
    options?: RequestOptions,
  ) {
    return this.run(
      "dailyOhlc",
      { symbol, from: range.from, to: range.to },
      z.array(CandleSchema),
      options,
    );
  }

  override async getIntradayOhlc(
    symbol: string,
    range: DateRange,
    options?: RequestOptions,
  ) {
    return this.run(
      "intradayOhlc",
      { symbol, from: range.from, to: range.to },
      z.array(CandleSchema),
      options,
    );
  }

  override async getIndexHistory(
    index: string,
    range: DateRange,
    options?: RequestOptions,
  ) {
    return this.run(
      "indexHistory",
      { index, from: range.from, to: range.to },
      z.array(CandleSchema),
      options,
    );
  }

  override async getLiveQuotes(options?: RequestOptions) {
    return this.run("liveQuotes", {}, z.array(QuoteSchema), options);
  }

  override async getMarketSummary(options?: RequestOptions) {
    return this.run("marketSummary", {}, MarketSummarySchema, options);
  }

  override async getSectorPerformance(options?: RequestOptions) {
    return this.run(
      "sectorPerformance",
      {},
      z.array(SectorPerformanceSchema),
      options,
    );
  }

  override async getFloorsheet(date: string, options?: RequestOptions) {
    return this.run(
      "floorsheet",
      { date },
      z.array(FloorsheetTradeSchema),
      options,
    );
  }

  override async getBrokerFlows(date: string, options?: RequestOptions) {
    return this.run(
      "brokerFlows",
      { date },
      z.array(BrokerFlowSchema),
      options,
    );
  }

  override async getFundamentals(symbol: string, options?: RequestOptions) {
    return this.run(
      "fundamentals",
      { symbol },
      FundamentalsSnapshotSchema,
      options,
    );
  }

  override async getFundamentalsHistory(
    symbol: string,
    range?: DateRange,
    options?: RequestOptions,
  ) {
    return this.run(
      "fundamentalsHistory",
      { symbol, from: range?.from, to: range?.to },
      z.array(FundamentalsSnapshotSchema),
      options,
    );
  }

  override async getCorporateActions(
    symbol: string,
    options?: RequestOptions,
  ) {
    return this.run(
      "corporateActions",
      { symbol },
      z.array(CorporateActionSchema),
      options,
    );
  }

  override async getIpos(options?: RequestOptions) {
    return this.run("ipos", {}, z.array(IpoSchema), options);
  }

  override async getNews(options?: RequestOptions) {
    return this.run("news", {}, z.array(NewsItemSchema), options);
  }

  async healthCheck(): Promise<ProviderHealth> {
    try {
      const started = Date.now();
      await this.run("health", {}, z.unknown());
      return {
        providerId: this.descriptor.id,
        status: "ok",
        checkedAt: new Date().toISOString(),
        latencyMs: Date.now() - started,
        consecutiveFailures: 0,
      };
    } catch (error) {
      return {
        providerId: this.descriptor.id,
        status: "down",
        checkedAt: new Date().toISOString(),
        consecutiveFailures: 1,
        message: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
