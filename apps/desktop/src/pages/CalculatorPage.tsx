import { useId, useState, type ReactNode } from "react";
import {
  NEPSE_FEE_SCHEDULE,
  bonusAdjustedPrice,
  bonusRightAdjustedPrice,
  breakevenSellPrice,
  buyCost,
  commissionTierFor,
  dividendYield,
  rightAdjustedPrice,
  sellProceeds,
  weightedAverageCost,
  type BuyCostResult,
  type FeeSchedule,
  type InvestorType,
  type SellProceedsResult,
} from "@stock/analytics";
import { formatNumber } from "../api";
import {
  Badge,
  Card,
  Delta,
  EmptyState,
  MiniStats,
  Notice,
  Tabs,
  toneOf,
} from "../components/ui";

type TabKey = "buy" | "sell" | "breakeven" | "wacc" | "corporate" | "dividend";

const TABS: Array<{ value: TabKey; label: string }> = [
  { value: "buy", label: "Buy" },
  { value: "sell", label: "Sell / profit" },
  { value: "breakeven", label: "Breakeven" },
  { value: "wacc", label: "WACC" },
  { value: "corporate", label: "Bonus & right" },
  { value: "dividend", label: "Dividend yield" },
];

// ---------------------------------------------------------------------------
// formatting and input parsing
// ---------------------------------------------------------------------------

function formatQty(value: number): string {
  return formatNumber(value, Number.isInteger(value) ? 0 : 2);
}

/** A rate in percent with as many decimals as it needs (2 to 4). */
function formatRate(percent: number): string {
  for (const digits of [2, 3, 4]) {
    const scaled = percent * 10 ** digits;
    if (Math.abs(scaled - Math.round(scaled)) < 1e-6) {
      return `${formatNumber(percent, digits)}%`;
    }
  }
  return `${formatNumber(percent, 4)}%`;
}

/** Negate for display as a deduction, without producing "-0.00". */
function less(value: number): number {
  return value === 0 ? 0 : -value;
}

function parseInput(text: string): number | null {
  const cleaned = text.replace(/,/g, "").trim();
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

interface Checked {
  value: number | null;
  error: string | null;
}

function check(
  text: string,
  label: string,
  {
    min = 0,
    exclusive = false,
    integer = false,
    optional = false,
  }: { min?: number; exclusive?: boolean; integer?: boolean; optional?: boolean } = {},
): Checked {
  const blank = text.trim() === "";
  if (blank && optional) return { value: null, error: null };
  const value = parseInput(text);
  if (value === null) {
    return { value: null, error: blank ? `${label} is required.` : `${label} must be a number.` };
  }
  if (exclusive ? value <= min : value < min) {
    return {
      value: null,
      error: `${label} must be ${exclusive ? "greater than" : "at least"} ${min}.`,
    };
  }
  if (integer && !Number.isInteger(value)) {
    return { value: null, error: `${label} must be a whole number.` };
  }
  return { value, error: null };
}

function attempt<T>(compute: () => T): { value: T | null; error: string | null } {
  try {
    return { value: compute(), error: null };
  } catch (cause) {
    return { value: null, error: cause instanceof Error ? cause.message : String(cause) };
  }
}

// ---------------------------------------------------------------------------
// small building blocks
// ---------------------------------------------------------------------------

function NumberField({
  label,
  value,
  onChange,
  checked,
  errorId,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  checked?: Checked;
  errorId?: string;
  placeholder?: string;
}) {
  const invalid = Boolean(checked?.error);
  return (
    <label>
      <span>{label}</span>
      <input
        value={value}
        inputMode="decimal"
        autoComplete="off"
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function InvestorField({
  value,
  onChange,
}: {
  value: InvestorType;
  onChange: (value: InvestorType) => void;
}) {
  return (
    <label>
      <span>Investor</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as InvestorType)}
      >
        <option value="individual">Individual</option>
        <option value="institution">Institution</option>
      </select>
    </label>
  );
}

function FormErrors({ id, checks }: { id: string; checks: Array<Checked | string | null> }) {
  const errors = checks
    .map((item) => (typeof item === "string" || item === null ? item : item.error))
    .filter((error): error is string => Boolean(error));
  return (
    <div id={id} aria-live="polite">
      {errors.length > 0 && (
        <div className="form-error" style={{ marginTop: 0 }}>
          {errors.map((error) => (
            <div key={error}>{error}</div>
          ))}
        </div>
      )}
    </div>
  );
}

interface BreakdownRow {
  label: string;
  basis?: ReactNode;
  values: Array<number | null>;
  strong?: boolean;
  tone?: "up" | "down" | "flat";
  /** Decimal places for the values (default 2). */
  digits?: number;
}

function BreakdownTable({
  caption,
  rows,
  headers = ["NPR"],
}: {
  caption: string;
  rows: BreakdownRow[];
  headers?: string[];
}) {
  return (
    <div className="table-scroll">
      <table className="table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Basis</th>
            {headers.map((header) => (
              <th key={header} scope="col" className="right">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td style={row.strong ? { fontWeight: 600 } : undefined}>{row.label}</td>
              <td className="muted small">{row.basis ?? ""}</td>
              {row.values.map((value, index) => (
                <td
                  key={headers[index] ?? index}
                  className={`right mono ${row.tone ? `tone-${row.tone}` : ""}`}
                  style={row.strong ? { fontWeight: 600 } : undefined}
                >
                  {formatNumber(value, row.digits ?? 2)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function bandLabel(amount: number, schedule: FeeSchedule): string {
  const tier = commissionTierFor(amount, schedule);
  if (tier.index < 0) return "no band";
  if (tier.upTo === null) return `above ${formatNumber(tier.from, 0)}`;
  if (tier.from === 0) return `up to ${formatNumber(tier.upTo, 0)}`;
  return `${formatNumber(tier.from, 0)}–${formatNumber(tier.upTo, 0)}`;
}

function commissionBasis(
  amount: number,
  result: { commissionRatePercent: number; minCommissionApplied: boolean },
  schedule: FeeSchedule,
): string {
  const band = `${formatRate(result.commissionRatePercent)} band (${bandLabel(amount, schedule)})`;
  return result.minCommissionApplied
    ? `Minimum NPR ${formatNumber(schedule.minCommission)} applies · ${band}`
    : band;
}

function buyRows(
  quantity: number,
  price: number,
  buy: BuyCostResult,
  schedule: FeeSchedule,
): BreakdownRow[] {
  const rows: BreakdownRow[] = [
    {
      label: "Share amount",
      basis: `${formatQty(quantity)} × ${formatNumber(price)}`,
      values: [buy.amount],
    },
    {
      label: "Broker commission",
      basis: commissionBasis(buy.amount, buy, schedule),
      values: [buy.commission],
    },
    {
      label: "SEBON fee",
      basis: `${formatRate(schedule.sebonFeePercent)} of amount`,
      values: [buy.sebonFee],
    },
    {
      label: "DP charge",
      basis: "Per scrip, per transaction day",
      values: [buy.dpCharge],
    },
  ];
  if (buy.nameTransferFee > 0) {
    rows.push({
      label: "Name-transfer fee",
      basis: "Per buy transaction",
      values: [buy.nameTransferFee],
    });
  }
  rows.push(
    { label: "Total payable", basis: `Fees ${formatNumber(buy.fees)}`, values: [buy.total], strong: true },
    { label: "Cost per share", basis: "Total ÷ quantity", values: [buy.costPerShare] },
  );
  return rows;
}

function sellRows({
  quantity,
  buyPrice,
  sellPrice,
  holdingDays,
  investor,
  buy,
  sell,
  schedule,
}: {
  quantity: number;
  buyPrice: number;
  sellPrice: number;
  holdingDays: number;
  investor: InvestorType;
  buy: BuyCostResult;
  sell: SellProceedsResult;
  schedule: FeeSchedule;
}): BreakdownRow[] {
  const longTerm = holdingDays >= schedule.longTermHoldingDays;
  const cgtBasis =
    investor === "institution"
      ? `${formatRate(sell.cgtRate)} institution rate`
      : `${formatRate(sell.cgtRate)} individual, held ${longTerm ? "≥" : "<"} ${formatQty(
          schedule.longTermHoldingDays,
        )} days`;
  return [
    {
      label: "Sell amount",
      basis: `${formatQty(quantity)} × ${formatNumber(sellPrice)}`,
      values: [sell.amount],
    },
    {
      label: "Broker commission",
      basis: commissionBasis(sell.amount, sell, schedule),
      values: [less(sell.commission)],
    },
    {
      label: "SEBON fee",
      basis: `${formatRate(schedule.sebonFeePercent)} of amount`,
      values: [less(sell.sebonFee)],
    },
    {
      label: "DP charge",
      basis: "Per scrip, per transaction day",
      values: [less(sell.dpCharge)],
    },
    {
      label: "Receivable before tax",
      basis: `Selling fees ${formatNumber(sell.fees)}`,
      values: [sell.receivableBeforeTax],
      strong: true,
    },
    {
      label: "Total buy cost",
      basis: `${formatQty(quantity)} × ${formatNumber(buyPrice)} + fees ${formatNumber(buy.fees)}`,
      values: [less(buy.total)],
    },
    {
      label: sell.gain >= 0 ? "Capital gain" : "Capital loss",
      basis: "Receivable before tax − total buy cost",
      values: [sell.gain],
      tone: toneOf(sell.gain),
    },
    {
      label: "Capital gains tax",
      basis: sell.gain > 0 ? cgtBasis : "Not charged on a loss",
      values: [less(sell.cgt)],
    },
    {
      label: "Net receivable",
      basis: "Paid out after tax",
      values: [sell.receivable],
      strong: true,
    },
    {
      label: "Net profit",
      basis:
        sell.returnPercent === null
          ? undefined
          : `${formatNumber(sell.returnPercent)}% of total buy cost`,
      values: [sell.netProfit],
      strong: true,
      tone: toneOf(sell.netProfit),
    },
  ];
}

// ---------------------------------------------------------------------------
// tabs
// ---------------------------------------------------------------------------

interface TradeDraft {
  quantity: string;
  buyPrice: string;
  sellPrice: string;
  holdingDays: string;
  investor: InvestorType;
  target: string;
}

interface TradeProps {
  draft: TradeDraft;
  update: (patch: Partial<TradeDraft>) => void;
  schedule: FeeSchedule;
}

function BuyTab({ draft, update, schedule }: TradeProps) {
  const errorId = useId();
  const quantity = check(draft.quantity, "Quantity", { exclusive: true });
  const price = check(draft.buyPrice, "Buy price", { exclusive: true });
  const buy =
    quantity.value !== null && price.value !== null
      ? buyCost({ quantity: quantity.value, price: price.value, schedule })
      : null;

  return (
    <div className="stack">
      <div className="form-grid">
        <NumberField
          label="Quantity"
          value={draft.quantity}
          onChange={(value) => update({ quantity: value })}
          checked={quantity}
          errorId={errorId}
        />
        <NumberField
          label="Buy price (NPR)"
          value={draft.buyPrice}
          onChange={(value) => update({ buyPrice: value })}
          checked={price}
          errorId={errorId}
        />
      </div>
      <FormErrors id={errorId} checks={[quantity, price]} />
      {buy && quantity.value !== null && price.value !== null ? (
        <>
          <MiniStats
            items={[
              { label: "Total payable", value: formatNumber(buy.total) },
              { label: "Total fees", value: formatNumber(buy.fees) },
              {
                label: "Cost per share",
                value: formatNumber(buy.costPerShare),
                hint: `vs ${formatNumber(price.value)} price`,
              },
              {
                label: "Commission rate",
                value: formatRate(buy.commissionRatePercent),
                hint: buy.minCommissionApplied ? "minimum applies" : undefined,
              },
            ]}
          />
          <BreakdownTable
            caption="Buy cost breakdown"
            rows={buyRows(quantity.value, price.value, buy, schedule)}
          />
        </>
      ) : (
        <EmptyState title="Enter a quantity and price">
          The total payable includes broker commission, SEBON fee and DP charge.
        </EmptyState>
      )}
    </div>
  );
}

function SellTab({ draft, update, schedule }: TradeProps) {
  const errorId = useId();
  const quantity = check(draft.quantity, "Quantity", { exclusive: true });
  const buyPrice = check(draft.buyPrice, "Buy price", { exclusive: true });
  const sellPrice = check(draft.sellPrice, "Sell price", { exclusive: true });
  const holdingDays = check(draft.holdingDays, "Holding days", { integer: true });

  let body: ReactNode = (
    <EmptyState title="Enter the trade">
      Quantity, buy price, sell price and holding period are all needed.
    </EmptyState>
  );
  if (
    quantity.value !== null &&
    buyPrice.value !== null &&
    sellPrice.value !== null &&
    holdingDays.value !== null
  ) {
    const buy = buyCost({ quantity: quantity.value, price: buyPrice.value, schedule });
    const sell = sellProceeds({
      quantity: quantity.value,
      price: sellPrice.value,
      buyCostTotal: buy.total,
      holdingDays: holdingDays.value,
      investor: draft.investor,
      schedule,
    });
    body = (
      <>
        <MiniStats
          items={[
            { label: "Net receivable", value: formatNumber(sell.receivable) },
            {
              label: "Net profit",
              value: formatNumber(sell.netProfit),
              tone: toneOf(sell.netProfit),
            },
            {
              label: "Return",
              value: <Delta value={sell.returnPercent} />,
              hint: "on total buy cost",
            },
            {
              label: "Capital gains tax",
              value: formatNumber(sell.cgt),
              hint: `at ${formatRate(sell.cgtRate)}`,
            },
            {
              label: "All fees",
              value: formatNumber(buy.fees + sell.fees),
              hint: "buy + sell",
            },
          ]}
        />
        <BreakdownTable
          caption="Sell proceeds and profit breakdown"
          rows={sellRows({
            quantity: quantity.value,
            buyPrice: buyPrice.value,
            sellPrice: sellPrice.value,
            holdingDays: holdingDays.value,
            investor: draft.investor,
            buy,
            sell,
            schedule,
          })}
        />
      </>
    );
  }

  return (
    <div className="stack">
      <div className="form-grid">
        <NumberField
          label="Quantity"
          value={draft.quantity}
          onChange={(value) => update({ quantity: value })}
          checked={quantity}
          errorId={errorId}
        />
        <NumberField
          label="Buy price (NPR)"
          value={draft.buyPrice}
          onChange={(value) => update({ buyPrice: value })}
          checked={buyPrice}
          errorId={errorId}
        />
        <NumberField
          label="Sell price (NPR)"
          value={draft.sellPrice}
          onChange={(value) => update({ sellPrice: value })}
          checked={sellPrice}
          errorId={errorId}
        />
        <NumberField
          label="Holding days"
          value={draft.holdingDays}
          onChange={(value) => update({ holdingDays: value })}
          checked={holdingDays}
          errorId={errorId}
        />
        <InvestorField
          value={draft.investor}
          onChange={(investor) => update({ investor })}
        />
      </div>
      <FormErrors id={errorId} checks={[quantity, buyPrice, sellPrice, holdingDays]} />
      {body}
      <p className="muted small">
        Buy cost includes buy-side fees. Individuals pay the long-term CGT rate
        from {formatQty(schedule.longTermHoldingDays)} days held; CGT is charged
        only on a positive gain.
      </p>
    </div>
  );
}

function BreakevenTab({ draft, update, schedule }: TradeProps) {
  const errorId = useId();
  const quantity = check(draft.quantity, "Quantity", { exclusive: true });
  const buyPrice = check(draft.buyPrice, "Buy price", { exclusive: true });
  const holdingDays = check(draft.holdingDays, "Holding days", { integer: true });
  const target = check(draft.target, "Target net profit", { min: -Infinity, optional: true });

  let solveError: string | null = null;
  let body: ReactNode = (
    <EmptyState title="Enter the purchase">
      Quantity, buy price and holding period are needed to solve for the sell
      price.
    </EmptyState>
  );
  if (
    quantity.value !== null &&
    buyPrice.value !== null &&
    holdingDays.value !== null &&
    !target.error
  ) {
    const q = quantity.value;
    const days = holdingDays.value;
    const targetProfit = target.value ?? 0;
    const buy = buyCost({ quantity: q, price: buyPrice.value, schedule });
    const solved = attempt(() =>
      breakevenSellPrice({
        quantity: q,
        buyCostTotal: buy.total,
        holdingDays: days,
        investor: draft.investor,
        targetNetProfit: targetProfit,
        schedule,
      }),
    );
    solveError = solved.error;
    if (solved.value !== null) {
      const price = solved.value;
      const sell = sellProceeds({
        quantity: q,
        price,
        buyCostTotal: buy.total,
        holdingDays: days,
        investor: draft.investor,
        schedule,
      });
      const rise = ((price - buyPrice.value) / buyPrice.value) * 100;
      body = (
        <>
          <MiniStats
            items={[
              {
                label: targetProfit === 0 ? "Breakeven price" : "Target price",
                value: formatNumber(price),
                hint: "lowest, to the paisa",
              },
              { label: "Rise needed", value: <Delta value={rise} />, hint: "vs buy price" },
              {
                label: "Cost per share",
                value: formatNumber(buy.costPerShare),
                hint: "incl. buy fees",
              },
              {
                label: "Net profit there",
                value: formatNumber(sell.netProfit),
                tone: toneOf(sell.netProfit),
              },
            ]}
          />
          <BreakdownTable
            caption={`Sell breakdown at ${formatNumber(price)}`}
            rows={sellRows({
              quantity: q,
              buyPrice: buyPrice.value,
              sellPrice: price,
              holdingDays: days,
              investor: draft.investor,
              buy,
              sell,
              schedule,
            })}
          />
        </>
      );
    }
  }

  return (
    <div className="stack">
      <div className="form-grid">
        <NumberField
          label="Quantity"
          value={draft.quantity}
          onChange={(value) => update({ quantity: value })}
          checked={quantity}
          errorId={errorId}
        />
        <NumberField
          label="Buy price (NPR)"
          value={draft.buyPrice}
          onChange={(value) => update({ buyPrice: value })}
          checked={buyPrice}
          errorId={errorId}
        />
        <NumberField
          label="Holding days"
          value={draft.holdingDays}
          onChange={(value) => update({ holdingDays: value })}
          checked={holdingDays}
          errorId={errorId}
        />
        <InvestorField
          value={draft.investor}
          onChange={(investor) => update({ investor })}
        />
        <NumberField
          label="Target net profit (NPR)"
          value={draft.target}
          placeholder="0"
          onChange={(value) => update({ target: value })}
          checked={target}
          errorId={errorId}
        />
      </div>
      <FormErrors id={errorId} checks={[quantity, buyPrice, holdingDays, target, solveError]} />
      {body}
      <p className="muted small">
        Solved by bisection over whole paisa: the lowest sell price whose net
        profit after selling fees and CGT reaches the target. At breakeven the
        gain is zero, so the CGT rate only matters for a positive target.
        Commission bands step down at band edges, so proceeds jump there and the
        profit at the solved price can exceed the target slightly.
      </p>
    </div>
  );
}

interface LotDraft {
  id: number;
  quantity: string;
  price: string;
  includeFees: boolean;
}

function WaccTab({
  lots,
  setLots,
  schedule,
}: {
  lots: LotDraft[];
  setLots: (update: (lots: LotDraft[]) => LotDraft[]) => void;
  schedule: FeeSchedule;
}) {
  const errorId = useId();
  const checks = lots.map((lot, index) => ({
    quantity: check(lot.quantity, `Lot ${index + 1} quantity`, { exclusive: true }),
    price: check(lot.price, `Lot ${index + 1} price`),
  }));
  const allValid = checks.every(
    (item) => item.quantity.value !== null && item.price.value !== null,
  );
  const result = allValid
    ? weightedAverageCost(
        lots.map((lot, index) => ({
          quantity: checks[index]?.quantity.value ?? 0,
          price: checks[index]?.price.value ?? 0,
          includeFees: lot.includeFees,
        })),
        schedule,
      )
    : null;

  const patch = (id: number, change: Partial<LotDraft>) =>
    setLots((current) => current.map((lot) => (lot.id === id ? { ...lot, ...change } : lot)));

  return (
    <div className="stack">
      <div className="table-scroll">
        <table className="table">
          <caption className="sr-only">Purchase lots</caption>
          <thead>
            <tr>
              <th scope="col">Lot</th>
              <th scope="col">Quantity</th>
              <th scope="col">Price (NPR)</th>
              <th scope="col">Buy fees</th>
              <th scope="col" className="right">Fees</th>
              <th scope="col" className="right">Cost</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lots.map((lot, index) => {
              const row = result?.lots[index];
              const rowCheck = checks[index];
              const name = `Lot ${index + 1}`;
              return (
                <tr key={lot.id}>
                  <td className="muted">{index + 1}</td>
                  <td>
                    <input
                      aria-label={`${name} quantity`}
                      value={lot.quantity}
                      inputMode="decimal"
                      autoComplete="off"
                      style={{ width: "100%", minWidth: 80 }}
                      aria-invalid={rowCheck?.quantity.error ? true : undefined}
                      aria-describedby={rowCheck?.quantity.error ? errorId : undefined}
                      onChange={(event) => patch(lot.id, { quantity: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      aria-label={`${name} price (NPR)`}
                      value={lot.price}
                      inputMode="decimal"
                      autoComplete="off"
                      style={{ width: "100%", minWidth: 80 }}
                      aria-invalid={rowCheck?.price.error ? true : undefined}
                      aria-describedby={rowCheck?.price.error ? errorId : undefined}
                      onChange={(event) => patch(lot.id, { price: event.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`${name}: add buy fees`}
                      checked={lot.includeFees}
                      onChange={(event) => patch(lot.id, { includeFees: event.target.checked })}
                    />
                  </td>
                  <td className="right mono">{formatNumber(row?.fees)}</td>
                  <td className="right mono">{formatNumber(row?.cost)}</td>
                  <td className="right">
                    <button
                      type="button"
                      className="button button-ghost button-small"
                      aria-label={`Remove ${name.toLowerCase()}`}
                      disabled={lots.length <= 1}
                      onClick={() => setLots((current) => current.filter((item) => item.id !== lot.id))}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button
          type="button"
          className="button button-ghost button-small"
          onClick={() =>
            setLots((current) => [
              ...current,
              {
                id: Math.max(0, ...current.map((lot) => lot.id)) + 1,
                quantity: "",
                price: "",
                includeFees: true,
              },
            ])
          }
        >
          Add lot
        </button>
      </div>
      <FormErrors
        id={errorId}
        checks={checks.flatMap((item) => [item.quantity, item.price])}
      />
      {result && result.averageCost !== null ? (
        <MiniStats
          items={[
            { label: "WACC per share", value: formatNumber(result.averageCost) },
            { label: "Total shares", value: formatQty(result.totalQuantity) },
            { label: "Total cost", value: formatNumber(result.totalCost) },
            {
              label: "Fees capitalised",
              value: formatNumber(result.lots.reduce((sum, lot) => sum + lot.fees, 0)),
            },
          ]}
        />
      ) : (
        <EmptyState title="Complete every lot">
          Each lot needs a quantity above zero and a price.
        </EmptyState>
      )}
      <p className="muted small">
        Tick “Buy fees” for secondary-market purchases so commission, SEBON fee
        and DP charge are added to that lot’s cost. Untick it for IPO, right or
        bonus lots and enter the price recorded in your Meroshare purchase
        source.
      </p>
    </div>
  );
}

interface CorporateDraft {
  price: string;
  bonus: string;
  right: string;
  rightPrice: string;
  held: string;
}

function CorporateTab({
  draft,
  update,
}: {
  draft: CorporateDraft;
  update: (patch: Partial<CorporateDraft>) => void;
}) {
  const errorId = useId();
  const price = check(draft.price, "Market price", { exclusive: true });
  const bonus = check(draft.bonus, "Bonus %", { optional: true });
  const right = check(draft.right, "Right %", { optional: true });
  const rightPrice = check(draft.rightPrice, "Right issue price", { exclusive: true });
  const held = check(draft.held, "Shares held", { optional: true });
  const valid = [price, bonus, right, rightPrice, held].every((item) => !item.error);

  let body: ReactNode = (
    <EmptyState title="Enter the market price and the announced issue">
      Leave bonus or right blank when only one is announced.
    </EmptyState>
  );
  if (valid && price.value !== null && rightPrice.value !== null) {
    const p = price.value;
    const b = bonus.value ?? 0;
    const r = right.value ?? 0;
    const rp = rightPrice.value;
    const adjusted = bonusRightAdjustedPrice(p, b, r, rp);
    const change = ((adjusted - p) / p) * 100;
    const holding =
      held.value !== null && held.value > 0
        ? {
            shares: held.value,
            bonusShares: (held.value * b) / 100,
            rightShares: (held.value * r) / 100,
          }
        : null;
    body = (
      <>
        <MiniStats
          items={[
            { label: "Adjusted price", value: formatNumber(adjusted), hint: "after book close" },
            { label: "Change", value: <Delta value={change} />, hint: "vs market price" },
            { label: "Bonus", value: `${formatNumber(b)}%` },
            {
              label: "Right",
              value: `${formatNumber(r)}%`,
              hint: r > 0 ? `at ${formatNumber(rp)}` : undefined,
            },
          ]}
        />
        {b > 0 || r > 0 ? (
          <BreakdownTable
            caption="Adjusted price by corporate action"
            rows={[
              ...(b > 0
                ? [
                    {
                      label: "Bonus only",
                      basis: `${formatNumber(p)} ÷ (1 + ${formatNumber(b)}%)`,
                      values: [bonusAdjustedPrice(p, b)],
                      strong: r === 0,
                    },
                  ]
                : []),
              ...(r > 0
                ? [
                    {
                      label: "Right only",
                      basis: `(${formatNumber(p)} + ${formatNumber(r)}% × ${formatNumber(rp)}) ÷ (1 + ${formatNumber(r)}%)`,
                      values: [rightAdjustedPrice(p, r, rp)],
                      strong: b === 0,
                    },
                  ]
                : []),
              ...(b > 0 && r > 0
                ? [
                    {
                      label: "Bonus and right together",
                      basis: `(${formatNumber(p)} + ${formatNumber(r)}% × ${formatNumber(rp)}) ÷ (1 + ${formatNumber(b)}% + ${formatNumber(r)}%)`,
                      values: [adjusted],
                      strong: true,
                    },
                  ]
                : []),
            ]}
          />
        ) : (
          <p className="muted small">
            No bonus or right entered, so the price is unchanged.
          </p>
        )}
        {holding && (
          <MiniStats
            items={[
              { label: "Bonus shares", value: formatQty(holding.bonusShares) },
              { label: "Right shares", value: formatQty(holding.rightShares) },
              {
                label: "Cost of rights",
                value: formatNumber(holding.rightShares * rp),
                hint: "if fully subscribed",
              },
              {
                label: "Holding after",
                value: formatQty(holding.shares + holding.bonusShares + holding.rightShares),
                hint: `was ${formatQty(holding.shares)}`,
              },
            ]}
          />
        )}
      </>
    );
  }

  return (
    <div className="stack">
      <div className="form-grid">
        <NumberField
          label="Market price before book close (NPR)"
          value={draft.price}
          onChange={(value) => update({ price: value })}
          checked={price}
          errorId={errorId}
        />
        <NumberField
          label="Bonus (%)"
          value={draft.bonus}
          placeholder="0"
          onChange={(value) => update({ bonus: value })}
          checked={bonus}
          errorId={errorId}
        />
        <NumberField
          label="Right (%)"
          value={draft.right}
          placeholder="0"
          onChange={(value) => update({ right: value })}
          checked={right}
          errorId={errorId}
        />
        <NumberField
          label="Right issue price (NPR)"
          value={draft.rightPrice}
          onChange={(value) => update({ rightPrice: value })}
          checked={rightPrice}
          errorId={errorId}
        />
        <NumberField
          label="Shares held (optional)"
          value={draft.held}
          onChange={(value) => update({ held: value })}
          checked={held}
          errorId={errorId}
        />
      </div>
      <FormErrors id={errorId} checks={[price, bonus, right, rightPrice, held]} />
      {body}
      <p className="muted small">
        Percentages are of shares held: a 10% bonus gives 10 new shares per 100.
        Right shares are usually issued at the NPR 100 face value. Tax on bonus
        shares is shown on the Dividend yield tab.
      </p>
    </div>
  );
}

interface DividendDraft {
  cash: string;
  bonus: string;
  price: string;
  par: string;
  held: string;
}

function DividendTab({
  draft,
  update,
  schedule,
}: {
  draft: DividendDraft;
  update: (patch: Partial<DividendDraft>) => void;
  schedule: FeeSchedule;
}) {
  const errorId = useId();
  const cash = check(draft.cash, "Cash dividend %", { optional: true });
  const bonus = check(draft.bonus, "Bonus %", { optional: true });
  const price = check(draft.price, "Market price", { exclusive: true });
  const par = check(draft.par, "Par value", { exclusive: true });
  const held = check(draft.held, "Shares held", { optional: true });
  const valid = [cash, bonus, price, par, held].every((item) => !item.error);

  let body: ReactNode = (
    <EmptyState title="Enter the declared dividend and a price">
      Dividend percentages are of the par value, as announced by the company.
    </EmptyState>
  );
  if (valid && price.value !== null && par.value !== null) {
    const result = dividendYield({
      cashDividendPercent: cash.value ?? 0,
      bonusPercent: bonus.value ?? 0,
      price: price.value,
      parValue: par.value,
      quantity: held.value !== null && held.value > 0 ? held.value : undefined,
      schedule,
    });
    const totals = result.totals;
    const headers = totals ? ["Per share", `${formatQty(totals.quantity)} shares`] : ["Per share"];
    const pick = (perShare: number, total: number | undefined) =>
      totals ? [perShare, total ?? null] : [perShare];
    body = (
      <>
        <MiniStats
          items={[
            {
              label: "Cash yield",
              value: `${formatNumber(result.cashYieldPercent)}%`,
              hint: "gross",
            },
            {
              label: "Net cash yield",
              value: `${formatNumber(result.netCashYieldPercent)}%`,
              hint: "after dividend taxes",
              tone: result.netCashPerShare < 0 ? "down" : undefined,
            },
            { label: "Cash per share", value: formatNumber(result.cashPerShare) },
            { label: "Net per share", value: formatNumber(result.netCashPerShare) },
          ]}
        />
        <BreakdownTable
          caption="Dividend and tax breakdown"
          headers={headers}
          rows={[
            {
              label: "Cash dividend",
              basis: `${formatNumber(cash.value ?? 0)}% of NPR ${formatNumber(par.value)} par`,
              values: pick(result.cashPerShare, totals?.grossCash),
            },
            {
              label: "Tax on cash dividend",
              basis: `${formatRate(schedule.cashDividendTaxPercent)} final withholding`,
              values: pick(less(result.taxOnCash), totals ? less(totals.taxOnCash) : undefined),
            },
            {
              label: "Tax on bonus shares",
              basis: `${formatRate(schedule.bonusTaxPercent)} of bonus face value ${formatNumber(
                result.bonusFaceValuePerShare,
              )}`,
              values: pick(less(result.taxOnBonus), totals ? less(totals.taxOnBonus) : undefined),
            },
            {
              label: "Net cash receivable",
              basis: result.netCashPerShare < 0 ? "Negative: tax owed in cash" : "After taxes",
              values: pick(result.netCashPerShare, totals?.netCash),
              strong: true,
              tone: result.netCashPerShare < 0 ? "down" : undefined,
            },
            {
              label: "Bonus shares",
              basis: `${formatNumber(bonus.value ?? 0)}% of shares held`,
              values: pick(result.bonusSharesPerShare, totals?.bonusShares),
              digits: 4,
            },
          ]}
        />
      </>
    );
  }

  return (
    <div className="stack">
      <div className="form-grid">
        <NumberField
          label="Cash dividend (%)"
          value={draft.cash}
          placeholder="0"
          onChange={(value) => update({ cash: value })}
          checked={cash}
          errorId={errorId}
        />
        <NumberField
          label="Bonus (%)"
          value={draft.bonus}
          placeholder="0"
          onChange={(value) => update({ bonus: value })}
          checked={bonus}
          errorId={errorId}
        />
        <NumberField
          label="Market price (NPR)"
          value={draft.price}
          onChange={(value) => update({ price: value })}
          checked={price}
          errorId={errorId}
        />
        <NumberField
          label="Par value (NPR)"
          value={draft.par}
          onChange={(value) => update({ par: value })}
          checked={par}
          errorId={errorId}
        />
        <NumberField
          label="Shares held (optional)"
          value={draft.held}
          onChange={(value) => update({ held: value })}
          checked={held}
          errorId={errorId}
        />
      </div>
      <FormErrors id={errorId} checks={[cash, bonus, price, par, held]} />
      {body}
      <p className="muted small">
        Tax on bonus shares is usually deducted from the cash dividend; when the
        cash dividend is too small, the shortfall is collected from the
        shareholder. Yield uses the price you enter, not the price after book
        close.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// fee schedule editor
// ---------------------------------------------------------------------------

type ScalarKey =
  | "minCommission"
  | "sebonFeePercent"
  | "dpChargePerScrip"
  | "nameTransferFee"
  | "cgtIndividualShortTermPercent"
  | "cgtIndividualLongTermPercent"
  | "cgtInstitutionPercent"
  | "longTermHoldingDays"
  | "cashDividendTaxPercent"
  | "bonusTaxPercent";

const SCALAR_FIELDS: Array<{
  key: ScalarKey;
  label: (schedule: FeeSchedule) => string;
  percent: boolean;
}> = [
  { key: "minCommission", label: () => "Minimum commission (NPR)", percent: false },
  { key: "sebonFeePercent", label: () => "SEBON fee (%)", percent: true },
  { key: "dpChargePerScrip", label: () => "DP charge per scrip (NPR)", percent: false },
  { key: "nameTransferFee", label: () => "Name-transfer fee on buy (NPR)", percent: false },
  {
    key: "cgtIndividualShortTermPercent",
    label: (s) => `CGT individual, < ${formatQty(s.longTermHoldingDays)} days (%)`,
    percent: true,
  },
  {
    key: "cgtIndividualLongTermPercent",
    label: (s) => `CGT individual, ≥ ${formatQty(s.longTermHoldingDays)} days (%)`,
    percent: true,
  },
  { key: "cgtInstitutionPercent", label: () => "CGT institution (%)", percent: true },
  { key: "longTermHoldingDays", label: () => "Long-term from (days)", percent: false },
  { key: "cashDividendTaxPercent", label: () => "Cash dividend tax (%)", percent: true },
  { key: "bonusTaxPercent", label: () => "Bonus share tax (%)", percent: true },
];

interface ScheduleDraft {
  tiers: Array<{ upTo: string; rate: string }>;
  scalars: Record<ScalarKey, string>;
}

function toDraft(schedule: FeeSchedule): ScheduleDraft {
  const scalars = {} as Record<ScalarKey, string>;
  for (const field of SCALAR_FIELDS) scalars[field.key] = String(schedule[field.key]);
  return {
    tiers: schedule.commissionTiers.map((tier) => ({
      upTo: tier.upTo === null ? "" : String(tier.upTo),
      rate: String(tier.ratePercent),
    })),
    scalars,
  };
}

const DEFAULT_DRAFT = toDraft(NEPSE_FEE_SCHEDULE);

/**
 * Turn the editable strings into a schedule. Anything unparseable falls back
 * to the default value and is reported, so a half-typed field never breaks
 * the calculators.
 */
function fromDraft(draft: ScheduleDraft): { schedule: FeeSchedule; invalid: Map<string, string> } {
  const invalid = new Map<string, string>();
  const read = (text: string, fallback: number, id: string, label: string, max = Infinity) => {
    const value = parseInput(text);
    if (value === null || value < 0 || value >= max) {
      invalid.set(id, label);
      return fallback;
    }
    return value;
  };

  const defaults = NEPSE_FEE_SCHEDULE.commissionTiers;
  const lastIndex = draft.tiers.length - 1;
  let previousUpTo = 0;
  const commissionTiers = draft.tiers.map((tier, index) => {
    const fallback = defaults[index];
    const upTo =
      index === lastIndex
        ? null
        : read(tier.upTo, fallback?.upTo ?? previousUpTo, `tier-${index}-upTo`, `Band ${index + 1} limit`);
    if (upTo !== null) {
      if (upTo <= previousUpTo && index > 0) {
        invalid.set(`tier-${index}-upTo`, `Band ${index + 1} limit (must exceed the band above)`);
      }
      previousUpTo = upTo;
    }
    return {
      upTo,
      ratePercent: read(tier.rate, fallback?.ratePercent ?? 0, `tier-${index}-rate`, `Band ${index + 1} rate`, 100),
    };
  });

  const schedule: FeeSchedule = { ...NEPSE_FEE_SCHEDULE, commissionTiers };
  for (const field of SCALAR_FIELDS) {
    schedule[field.key] = read(
      draft.scalars[field.key],
      NEPSE_FEE_SCHEDULE[field.key],
      field.key,
      field.label(NEPSE_FEE_SCHEDULE),
      field.percent ? 100 : Infinity,
    );
  }
  return { schedule, invalid };
}

function scheduleSummary(schedule: FeeSchedule): string {
  const rates = schedule.commissionTiers.map((tier) => tier.ratePercent);
  const commission =
    rates.length > 0
      ? `${formatRate(Math.max(...rates))}–${formatRate(Math.min(...rates))}`
      : "none";
  return [
    `Commission ${commission} (min NPR ${formatNumber(schedule.minCommission)})`,
    `SEBON ${formatRate(schedule.sebonFeePercent)}`,
    `DP NPR ${formatNumber(schedule.dpChargePerScrip)}`,
    `CGT ${formatRate(schedule.cgtIndividualShortTermPercent)} / ${formatRate(
      schedule.cgtIndividualLongTermPercent,
    )} / ${formatRate(schedule.cgtInstitutionPercent)}`,
  ].join(" · ");
}

function FeeScheduleCard({
  draft,
  setDraft,
  schedule,
  invalid,
  edited,
}: {
  draft: ScheduleDraft;
  setDraft: (update: (draft: ScheduleDraft) => ScheduleDraft) => void;
  schedule: FeeSchedule;
  invalid: Map<string, string>;
  edited: boolean;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const errorId = useId();
  const lastIndex = draft.tiers.length - 1;

  const setTier = (index: number, change: Partial<{ upTo: string; rate: string }>) =>
    setDraft((current) => ({
      ...current,
      tiers: current.tiers.map((tier, i) => (i === index ? { ...tier, ...change } : tier)),
    }));

  const tierFrom = (index: number): string => {
    if (index === 0) return "0";
    const previous = schedule.commissionTiers[index - 1];
    return previous?.upTo === null || previous === undefined ? "—" : formatNumber(previous.upTo, 0);
  };

  return (
    <Card
      title="Fee schedule"
      subtitle={scheduleSummary(schedule)}
      action={
        <div className="row">
          {edited && <Badge tone="warn">Edited</Badge>}
          <button
            type="button"
            className="button button-ghost button-small"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? "Hide rates" : "Edit rates"}
          </button>
        </div>
      }
    >
      <div id={bodyId}>
        {open && (
          <div className="stack">
            <div className="table-scroll">
              <table className="table">
                <caption className="sr-only">Broker commission bands</caption>
                <thead>
                  <tr>
                    <th scope="col">Band</th>
                    <th scope="col">From (NPR, exclusive)</th>
                    <th scope="col">Up to (NPR, inclusive)</th>
                    <th scope="col">Rate (%)</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.tiers.map((tier, index) => (
                    <tr key={index}>
                      <td className="muted">{index + 1}</td>
                      <td className="mono muted">{tierFrom(index)}</td>
                      <td>
                        {index === lastIndex ? (
                          <span className="muted small">No upper limit</span>
                        ) : (
                          <input
                            aria-label={`Band ${index + 1} upper limit (NPR)`}
                            value={tier.upTo}
                            inputMode="decimal"
                            autoComplete="off"
                            style={{ width: "100%", minWidth: 100 }}
                            aria-invalid={invalid.has(`tier-${index}-upTo`) || undefined}
                            aria-describedby={invalid.has(`tier-${index}-upTo`) ? errorId : undefined}
                            onChange={(event) => setTier(index, { upTo: event.target.value })}
                          />
                        )}
                      </td>
                      <td>
                        <input
                          aria-label={`Band ${index + 1} commission rate (%)`}
                          value={tier.rate}
                          inputMode="decimal"
                          autoComplete="off"
                          style={{ width: "100%", minWidth: 80 }}
                          aria-invalid={invalid.has(`tier-${index}-rate`) || undefined}
                          aria-describedby={invalid.has(`tier-${index}-rate`) ? errorId : undefined}
                          onChange={(event) => setTier(index, { rate: event.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="form-grid">
              {SCALAR_FIELDS.map((field) => (
                <label key={field.key}>
                  <span>{field.label(schedule)}</span>
                  <input
                    value={draft.scalars[field.key]}
                    inputMode="decimal"
                    autoComplete="off"
                    aria-invalid={invalid.has(field.key) || undefined}
                    aria-describedby={invalid.has(field.key) ? errorId : undefined}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        scalars: { ...current.scalars, [field.key]: event.target.value },
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <FormErrors
              id={errorId}
              checks={
                invalid.size > 0
                  ? [
                      `Using the default for: ${[...invalid.values()].join(", ")}. Enter a number of 0 or more (percentages below 100).`,
                    ]
                  : []
              }
            />
            <div className="row-between">
              <span className="muted small">
                Changes apply to every tab for this session only and are not saved.
              </span>
              <button
                type="button"
                className="button button-ghost button-small"
                disabled={!edited}
                onClick={() => setDraft(() => DEFAULT_DRAFT)}
              >
                Reset to defaults
              </button>
            </div>
          </div>
        )}
      </div>
      <p className="muted small" style={{ marginTop: open ? 12 : 0 }}>
        {NEPSE_FEE_SCHEDULE.verifiedAsOf}
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// page
// ---------------------------------------------------------------------------

/** NEPSE share calculator. Takes no props; all state is local to the session. */
export function CalculatorPage() {
  const [tab, setTab] = useState<TabKey>("buy");
  const [trade, setTrade] = useState<TradeDraft>({
    quantity: "100",
    buyPrice: "500",
    sellPrice: "550",
    holdingDays: "30",
    investor: "individual",
    target: "",
  });
  const [lots, setLots] = useState<LotDraft[]>([
    { id: 1, quantity: "100", price: "500", includeFees: true },
    { id: 2, quantity: "50", price: "450", includeFees: true },
  ]);
  const [corporate, setCorporate] = useState<CorporateDraft>({
    price: "600",
    bonus: "10",
    right: "",
    rightPrice: "100",
    held: "",
  });
  const [dividend, setDividend] = useState<DividendDraft>({
    cash: "5",
    bonus: "10",
    price: "600",
    par: "100",
    held: "",
  });
  const [scheduleDraft, setScheduleDraft] = useState<ScheduleDraft>(DEFAULT_DRAFT);

  const { schedule, invalid } = fromDraft(scheduleDraft);
  const edited = JSON.stringify(scheduleDraft) !== JSON.stringify(DEFAULT_DRAFT);
  const updateTrade = (patch: Partial<TradeDraft>) =>
    setTrade((current) => ({ ...current, ...patch }));
  const tabLabel = TABS.find((item) => item.value === tab)?.label ?? "";

  return (
    <div className="stack">
      <Notice>
        Fees and tax rates change; confirm with your broker. Calculations are
        estimates, not advice.
      </Notice>

      <Card
        title="Share calculator"
        subtitle="NEPSE equity: broker commission, SEBON fee, DP charge and capital gains tax"
        action={edited ? <Badge tone="warn">Edited fee schedule</Badge> : undefined}
      >
        <Tabs value={tab} onChange={setTab} items={TABS} label="Calculator" />
        <div role="tabpanel" aria-label={tabLabel}>
          {tab === "buy" && <BuyTab draft={trade} update={updateTrade} schedule={schedule} />}
          {tab === "sell" && <SellTab draft={trade} update={updateTrade} schedule={schedule} />}
          {tab === "breakeven" && (
            <BreakevenTab draft={trade} update={updateTrade} schedule={schedule} />
          )}
          {tab === "wacc" && <WaccTab lots={lots} setLots={setLots} schedule={schedule} />}
          {tab === "corporate" && (
            <CorporateTab
              draft={corporate}
              update={(patch) => setCorporate((current) => ({ ...current, ...patch }))}
            />
          )}
          {tab === "dividend" && (
            <DividendTab
              draft={dividend}
              update={(patch) => setDividend((current) => ({ ...current, ...patch }))}
              schedule={schedule}
            />
          )}
        </div>
      </Card>

      <FeeScheduleCard
        draft={scheduleDraft}
        setDraft={setScheduleDraft}
        schedule={schedule}
        invalid={invalid}
        edited={edited}
      />
    </div>
  );
}
