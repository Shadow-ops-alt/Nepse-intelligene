/**
 * NEPSE equity trade costs: broker commission, SEBON fee, DP charge and
 * capital gains tax, plus corporate-action price adjustments and dividend
 * yield.
 *
 * Every rate lives in a {@link FeeSchedule} so callers (and the UI) can
 * override it. Values are computed at full precision and rounded to two
 * decimals (paisa) only when a public function returns them.
 */

export type InvestorType = "individual" | "institution";

export interface CommissionTier {
  /** Inclusive upper bound of the transaction amount (Rs). `null` means no upper bound. */
  upTo: number | null;
  /** Commission as a percent of the whole transaction amount (0.36 means 0.36%). */
  ratePercent: number;
}

export interface FeeSchedule {
  /**
   * Broker commission bands on the transaction amount. The band's flat rate
   * applies to the whole amount (not marginally).
   */
  commissionTiers: readonly CommissionTier[];
  /** Minimum broker commission per transaction (Rs). */
  minCommission: number;
  /** SEBON regulatory fee, percent of the transaction amount. */
  sebonFeePercent: number;
  /** CDS / DP charge per scrip per transaction day (Rs), on buys and sells. */
  dpChargePerScrip: number;
  /** Name-transfer fee charged on buys (Rs). Not applied unless set. */
  nameTransferFee: number;
  /** CGT for individuals holding less than `longTermHoldingDays`, percent of gain. */
  cgtIndividualShortTermPercent: number;
  /** CGT for individuals holding at least `longTermHoldingDays`, percent of gain. */
  cgtIndividualLongTermPercent: number;
  /** CGT for institutions regardless of holding period, percent of gain. */
  cgtInstitutionPercent: number;
  /** Holding period (days) from which the individual long-term rate applies. */
  longTermHoldingDays: number;
  /** Final withholding tax on cash dividends, percent. */
  cashDividendTaxPercent: number;
  /** Tax on the face value of bonus shares, percent (usually collected in cash). */
  bonusTaxPercent: number;
  /** Provenance note for these rates. */
  verifiedAsOf: string;
}

export const NEPSE_FEE_SCHEDULE: FeeSchedule = Object.freeze({
  commissionTiers: Object.freeze([
    Object.freeze({ upTo: 50_000, ratePercent: 0.36 }),
    Object.freeze({ upTo: 500_000, ratePercent: 0.33 }),
    Object.freeze({ upTo: 2_000_000, ratePercent: 0.31 }),
    Object.freeze({ upTo: 10_000_000, ratePercent: 0.27 }),
    Object.freeze({ upTo: null, ratePercent: 0.24 }),
  ]),
  minCommission: 10,
  sebonFeePercent: 0.015,
  dpChargePerScrip: 25,
  nameTransferFee: 0,
  cgtIndividualShortTermPercent: 7.5,
  cgtIndividualLongTermPercent: 5,
  cgtInstitutionPercent: 10,
  longTermHoldingDays: 365,
  cashDividendTaxPercent: 5,
  bonusTaxPercent: 5,
  verifiedAsOf:
    "Commonly published SEBON/NEPSE equity rates (broker commission bands, " +
    "SEBON fee 0.015%, DP charge Rs 25, CGT 7.5% / 5% / 10%, 5% dividend and " +
    "bonus tax). Not verified against a live source: check them against your " +
    "broker's current schedule before relying on any figure.",
});

/** Fill any missing (or explicitly undefined) fields from the default schedule. */
export function resolveFeeSchedule(schedule?: Partial<FeeSchedule>): FeeSchedule {
  if (!schedule) return NEPSE_FEE_SCHEDULE;
  const resolved: FeeSchedule = { ...NEPSE_FEE_SCHEDULE };
  for (const key of Object.keys(schedule) as Array<keyof FeeSchedule>) {
    const value = schedule[key];
    if (value !== undefined) {
      (resolved as unknown as Record<string, unknown>)[key] = value;
    }
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Round half away from zero via decimal-string shifting, so values such as
 * 1.005 or 477.775 round the way a person would expect.
 */
function roundTo(value: number, digits: number): number {
  if (!Number.isFinite(value)) return value;
  const magnitude = Math.abs(value);
  const text = String(magnitude);
  const rounded = text.includes("e")
    ? Math.round(magnitude * 10 ** digits) / 10 ** digits
    : Number(`${Math.round(Number(`${text}e${digits}`))}e-${digits}`);
  const signed = value < 0 ? -rounded : rounded;
  return signed === 0 ? 0 : signed;
}

const money = (value: number) => roundTo(value, 2);
const pct = (value: number) => roundTo(value, 4);

function requireNumber(
  name: string,
  value: number,
  { min = 0, exclusive = false }: { min?: number; exclusive?: boolean } = {},
): void {
  if (!Number.isFinite(value) || (exclusive ? value <= min : value < min)) {
    throw new RangeError(
      `${name} must be a finite number ${exclusive ? ">" : "≥"} ${min}, got ${value}`,
    );
  }
}

// ---------------------------------------------------------------------------
// commission and tax rates
// ---------------------------------------------------------------------------

export interface CommissionTierMatch {
  /** Index into the schedule's tiers sorted by `upTo`; -1 when there are no tiers. */
  index: number;
  /** Exclusive lower bound of the band (Rs); 0 for the first band. */
  from: number;
  /** Inclusive upper bound of the band (Rs); null for the open-ended top band. */
  upTo: number | null;
  ratePercent: number;
}

/** The commission band a transaction amount falls in. */
export function commissionTierFor(
  amount: number,
  schedule?: Partial<FeeSchedule>,
): CommissionTierMatch {
  const tiers = [...resolveFeeSchedule(schedule).commissionTiers].sort(
    (a, b) => (a.upTo ?? Infinity) - (b.upTo ?? Infinity),
  );
  let from = 0;
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index]!;
    if (tier.upTo === null || amount <= tier.upTo || index === tiers.length - 1) {
      return { index, from, upTo: tier.upTo, ratePercent: tier.ratePercent };
    }
    from = tier.upTo;
  }
  return { index: -1, from: 0, upTo: null, ratePercent: 0 };
}

interface RawCommission {
  commission: number;
  ratePercent: number;
  minApplied: boolean;
}

function commissionRaw(amount: number, schedule: FeeSchedule): RawCommission {
  const { ratePercent } = commissionTierFor(amount, schedule);
  if (amount <= 0) return { commission: 0, ratePercent, minApplied: false };
  const byRate = (amount * ratePercent) / 100;
  const minApplied = schedule.minCommission > byRate;
  return {
    commission: minApplied ? schedule.minCommission : byRate,
    ratePercent,
    minApplied,
  };
}

/**
 * Broker commission on a transaction amount: the band's flat rate on the whole
 * amount, never below the minimum commission. Zero for a zero amount.
 */
export function brokerCommission(amount: number, schedule?: Partial<FeeSchedule>): number {
  requireNumber("amount", amount);
  return money(commissionRaw(amount, resolveFeeSchedule(schedule)).commission);
}

/** Capital gains tax rate (percent) for a holding period and investor type. */
export function capitalGainsTaxRate(
  holdingDays: number,
  investor: InvestorType,
  schedule?: Partial<FeeSchedule>,
): number {
  const s = resolveFeeSchedule(schedule);
  if (investor === "institution") return s.cgtInstitutionPercent;
  return holdingDays >= s.longTermHoldingDays
    ? s.cgtIndividualLongTermPercent
    : s.cgtIndividualShortTermPercent;
}

// ---------------------------------------------------------------------------
// buy / sell
// ---------------------------------------------------------------------------

export interface BuyCostResult {
  /** quantity × price */
  amount: number;
  commission: number;
  /** Rate of the commission band applied (percent). */
  commissionRatePercent: number;
  /** True when the minimum commission replaced the band rate. */
  minCommissionApplied: boolean;
  sebonFee: number;
  dpCharge: number;
  nameTransferFee: number;
  /** All charges on top of the amount. */
  fees: number;
  /** Total payable to the broker. */
  total: number;
  /** total ÷ quantity */
  costPerShare: number;
}

interface RawBuy {
  amount: number;
  commission: number;
  commissionRatePercent: number;
  minCommissionApplied: boolean;
  sebonFee: number;
  dpCharge: number;
  nameTransferFee: number;
  total: number;
}

function buyRaw(quantity: number, price: number, s: FeeSchedule): RawBuy {
  const amount = quantity * price;
  const traded = amount > 0;
  const { commission, ratePercent, minApplied } = commissionRaw(amount, s);
  const sebonFee = (amount * s.sebonFeePercent) / 100;
  const dpCharge = traded ? s.dpChargePerScrip : 0;
  const nameTransferFee = traded ? s.nameTransferFee : 0;
  return {
    amount,
    commission,
    commissionRatePercent: ratePercent,
    minCommissionApplied: minApplied,
    sebonFee,
    dpCharge,
    nameTransferFee,
    total: amount + commission + sebonFee + dpCharge + nameTransferFee,
  };
}

/** Total cost of buying `quantity` shares at `price` in one transaction. */
export function buyCost({
  quantity,
  price,
  schedule,
}: {
  quantity: number;
  price: number;
  schedule?: Partial<FeeSchedule>;
}): BuyCostResult {
  requireNumber("quantity", quantity, { exclusive: true });
  requireNumber("price", price);
  const raw = buyRaw(quantity, price, resolveFeeSchedule(schedule));
  return {
    amount: money(raw.amount),
    commission: money(raw.commission),
    commissionRatePercent: raw.commissionRatePercent,
    minCommissionApplied: raw.minCommissionApplied,
    sebonFee: money(raw.sebonFee),
    dpCharge: money(raw.dpCharge),
    nameTransferFee: money(raw.nameTransferFee),
    fees: money(raw.total - raw.amount),
    total: money(raw.total),
    costPerShare: money(raw.total / quantity),
  };
}

export interface SellProceedsResult {
  /** quantity × price */
  amount: number;
  commission: number;
  /** Rate of the commission band applied (percent). */
  commissionRatePercent: number;
  minCommissionApplied: boolean;
  sebonFee: number;
  dpCharge: number;
  /** commission + SEBON fee + DP charge */
  fees: number;
  /** amount − commission − SEBON fee − DP charge (before CGT). */
  receivableBeforeTax: number;
  /** receivableBeforeTax − buyCostTotal; CGT is charged only when positive. */
  gain: number;
  /** CGT rate applied, in percent (7.5 means 7.5%). */
  cgtRate: number;
  cgt: number;
  /** receivableBeforeTax − CGT: what the seller is left with. */
  receivable: number;
  /** receivable − buyCostTotal */
  netProfit: number;
  /** netProfit ÷ buyCostTotal × 100; null when the buy cost is zero. */
  returnPercent: number | null;
}

interface SellInput {
  quantity: number;
  price: number;
  /** Total buy cost including buy-side fees, e.g. `buyCost(...).total`. */
  buyCostTotal: number;
  holdingDays: number;
  investor: InvestorType;
  schedule?: Partial<FeeSchedule>;
}

interface RawSell {
  amount: number;
  commission: number;
  commissionRatePercent: number;
  minCommissionApplied: boolean;
  sebonFee: number;
  dpCharge: number;
  receivableBeforeTax: number;
  gain: number;
  cgtRate: number;
  cgt: number;
  receivable: number;
  netProfit: number;
}

function sellRaw(
  quantity: number,
  price: number,
  buyCostTotal: number,
  holdingDays: number,
  investor: InvestorType,
  s: FeeSchedule,
): RawSell {
  const amount = quantity * price;
  const { commission, ratePercent, minApplied } = commissionRaw(amount, s);
  const sebonFee = (amount * s.sebonFeePercent) / 100;
  const dpCharge = amount > 0 ? s.dpChargePerScrip : 0;
  const receivableBeforeTax = amount - commission - sebonFee - dpCharge;
  const gain = receivableBeforeTax - buyCostTotal;
  const cgtRate = capitalGainsTaxRate(holdingDays, investor, s);
  const cgt = gain > 0 ? (gain * cgtRate) / 100 : 0;
  const receivable = receivableBeforeTax - cgt;
  return {
    amount,
    commission,
    commissionRatePercent: ratePercent,
    minCommissionApplied: minApplied,
    sebonFee,
    dpCharge,
    receivableBeforeTax,
    gain,
    cgtRate,
    cgt,
    receivable,
    netProfit: receivable - buyCostTotal,
  };
}

function checkSellInput(input: Omit<SellInput, "price" | "schedule">): void {
  requireNumber("quantity", input.quantity, { exclusive: true });
  requireNumber("buyCostTotal", input.buyCostTotal);
  requireNumber("holdingDays", input.holdingDays);
  if (input.investor !== "individual" && input.investor !== "institution") {
    throw new RangeError(`investor must be "individual" or "institution"`);
  }
}

/**
 * Proceeds, CGT and net profit from selling `quantity` shares at `price`
 * against a known total buy cost.
 */
export function sellProceeds(input: SellInput): SellProceedsResult {
  checkSellInput(input);
  requireNumber("price", input.price);
  const raw = sellRaw(
    input.quantity,
    input.price,
    input.buyCostTotal,
    input.holdingDays,
    input.investor,
    resolveFeeSchedule(input.schedule),
  );
  return {
    amount: money(raw.amount),
    commission: money(raw.commission),
    commissionRatePercent: raw.commissionRatePercent,
    minCommissionApplied: raw.minCommissionApplied,
    sebonFee: money(raw.sebonFee),
    dpCharge: money(raw.dpCharge),
    fees: money(raw.commission + raw.sebonFee + raw.dpCharge),
    receivableBeforeTax: money(raw.receivableBeforeTax),
    gain: money(raw.gain),
    cgtRate: raw.cgtRate,
    cgt: money(raw.cgt),
    receivable: money(raw.receivable),
    netProfit: money(raw.netProfit),
    returnPercent:
      input.buyCostTotal > 0 ? pct((raw.netProfit / input.buyCostTotal) * 100) : null,
  };
}

/**
 * Lowest sell price, to the paisa, at which the net profit after selling fees
 * and CGT reaches `targetNetProfit` (default 0, i.e. breakeven).
 *
 * Solved by bisection over whole paisa. Net proceeds rise monotonically with
 * price but jump upward where the commission band drops, so at a band edge the
 * profit at the returned price can exceed the target by more than a paisa per
 * share.
 */
export function breakevenSellPrice({
  quantity,
  buyCostTotal,
  holdingDays,
  investor,
  schedule,
  targetNetProfit = 0,
}: Omit<SellInput, "price"> & { targetNetProfit?: number }): number {
  checkSellInput({ quantity, buyCostTotal, holdingDays, investor });
  if (!Number.isFinite(targetNetProfit)) {
    throw new RangeError(`targetNetProfit must be finite, got ${targetNetProfit}`);
  }
  const s = resolveFeeSchedule(schedule);
  const reaches = (paisa: number) =>
    sellRaw(quantity, paisa / 100, buyCostTotal, holdingDays, investor, s).netProfit >=
    targetNetProfit - 1e-9;

  if (reaches(0)) return 0;
  let low = 0;
  let high = Math.max(1, Math.ceil(((buyCostTotal + Math.max(0, targetNetProfit)) / quantity) * 100));
  for (let guard = 0; !reaches(high); guard += 1) {
    if (guard > 200) throw new RangeError("No sell price reaches the target");
    low = high;
    high *= 2;
  }
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (reaches(mid)) high = mid;
    else low = mid;
  }
  return high / 100;
}

// ---------------------------------------------------------------------------
// WACC
// ---------------------------------------------------------------------------

export interface CostLot {
  quantity: number;
  price: number;
  /**
   * Add buy-side fees (commission, SEBON, DP, name transfer) to this lot's
   * cost, as for a secondary-market purchase. Defaults to false, e.g. for IPO,
   * right or bonus lots.
   */
  includeFees?: boolean;
}

export interface WeightedAverageCostResult {
  lots: Array<{
    quantity: number;
    price: number;
    includeFees: boolean;
    amount: number;
    fees: number;
    cost: number;
  }>;
  totalQuantity: number;
  totalCost: number;
  /** totalCost ÷ totalQuantity; null when there are no shares. */
  averageCost: number | null;
}

/** Weighted average cost per share across purchase lots. */
export function weightedAverageCost(
  lots: readonly CostLot[],
  schedule?: Partial<FeeSchedule>,
): WeightedAverageCostResult {
  const s = resolveFeeSchedule(schedule);
  let totalQuantity = 0;
  let totalCost = 0;
  const rows = lots.map((lot, index) => {
    requireNumber(`lots[${index}].quantity`, lot.quantity);
    requireNumber(`lots[${index}].price`, lot.price);
    const includeFees = lot.includeFees ?? false;
    const amount = lot.quantity * lot.price;
    const cost =
      includeFees && lot.quantity > 0 ? buyRaw(lot.quantity, lot.price, s).total : amount;
    totalQuantity += lot.quantity;
    totalCost += cost;
    return {
      quantity: lot.quantity,
      price: lot.price,
      includeFees,
      amount: money(amount),
      fees: money(cost - amount),
      cost: money(cost),
    };
  });
  return {
    lots: rows,
    totalQuantity,
    totalCost: money(totalCost),
    averageCost: totalQuantity > 0 ? money(totalCost / totalQuantity) : null,
  };
}

// ---------------------------------------------------------------------------
// corporate actions
// ---------------------------------------------------------------------------

/** Ex-bonus price: price ÷ (1 + bonus%). */
export function bonusAdjustedPrice(price: number, bonusPercent: number): number {
  return bonusRightAdjustedPrice(price, bonusPercent, 0);
}

/** Ex-right price: (price + right% × rightPrice) ÷ (1 + right%). */
export function rightAdjustedPrice(
  price: number,
  rightPercent: number,
  rightPrice = 100,
): number {
  return bonusRightAdjustedPrice(price, 0, rightPercent, rightPrice);
}

/**
 * Price adjusted for a bonus and a right issue with the same book closure:
 * (price + right% × rightPrice) ÷ (1 + bonus% + right%).
 */
export function bonusRightAdjustedPrice(
  price: number,
  bonusPercent: number,
  rightPercent: number,
  rightPrice = 100,
): number {
  requireNumber("price", price);
  requireNumber("bonusPercent", bonusPercent);
  requireNumber("rightPercent", rightPercent);
  requireNumber("rightPrice", rightPrice);
  const b = bonusPercent / 100;
  const r = rightPercent / 100;
  return money((price + r * rightPrice) / (1 + b + r));
}

// ---------------------------------------------------------------------------
// dividends
// ---------------------------------------------------------------------------

export interface DividendYieldResult {
  /** par × cash% */
  cashPerShare: number;
  /** cashPerShare ÷ price × 100 */
  cashYieldPercent: number;
  /** Final withholding tax on the cash dividend, per share held. */
  taxOnCash: number;
  /** par × bonus% */
  bonusFaceValuePerShare: number;
  /** Tax on the bonus face value, per share held (usually collected in cash). */
  taxOnBonus: number;
  /** cashPerShare − taxOnCash − taxOnBonus; negative means tax is owed. */
  netCashPerShare: number;
  /** netCashPerShare ÷ price × 100 */
  netCashYieldPercent: number;
  /** New shares per share held (bonus% ÷ 100). */
  bonusSharesPerShare: number;
  /** Totals for `quantity` shares, when a quantity is given. */
  totals: {
    quantity: number;
    grossCash: number;
    taxOnCash: number;
    taxOnBonus: number;
    netCash: number;
    bonusShares: number;
  } | null;
}

/** Cash dividend yield and dividend taxes for a declared cash and bonus dividend. */
export function dividendYield({
  cashDividendPercent,
  bonusPercent = 0,
  price,
  parValue = 100,
  quantity,
  schedule,
}: {
  cashDividendPercent: number;
  bonusPercent?: number;
  price: number;
  parValue?: number;
  /** Shares held; when given, `totals` is filled in. */
  quantity?: number;
  schedule?: Partial<FeeSchedule>;
}): DividendYieldResult {
  requireNumber("cashDividendPercent", cashDividendPercent);
  requireNumber("bonusPercent", bonusPercent);
  requireNumber("price", price, { exclusive: true });
  requireNumber("parValue", parValue, { exclusive: true });
  if (quantity !== undefined) requireNumber("quantity", quantity);
  const s = resolveFeeSchedule(schedule);

  const cashPerShare = (parValue * cashDividendPercent) / 100;
  const taxOnCash = (cashPerShare * s.cashDividendTaxPercent) / 100;
  const bonusFaceValue = (parValue * bonusPercent) / 100;
  const taxOnBonus = (bonusFaceValue * s.bonusTaxPercent) / 100;
  const netCash = cashPerShare - taxOnCash - taxOnBonus;

  return {
    cashPerShare: money(cashPerShare),
    cashYieldPercent: pct((cashPerShare / price) * 100),
    taxOnCash: money(taxOnCash),
    bonusFaceValuePerShare: money(bonusFaceValue),
    taxOnBonus: money(taxOnBonus),
    netCashPerShare: money(netCash),
    netCashYieldPercent: pct((netCash / price) * 100),
    bonusSharesPerShare: roundTo(bonusPercent / 100, 6),
    totals:
      quantity === undefined
        ? null
        : {
            quantity,
            grossCash: money(cashPerShare * quantity),
            taxOnCash: money(taxOnCash * quantity),
            taxOnBonus: money(taxOnBonus * quantity),
            netCash: money(netCash * quantity),
            bonusShares: roundTo((quantity * bonusPercent) / 100, 6),
          },
  };
}
