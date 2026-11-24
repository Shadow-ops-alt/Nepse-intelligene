import { useMemo, useState, type FormEvent } from "react";
import { buyCost, sellProceeds, type BuyCostResult } from "@stock/analytics";
import { api, formatNumber } from "../api";
import { useApi } from "../hooks";
import type {
  CompaniesResponse,
  TradePlan,
  TradePlansResponse,
  TradeSide,
} from "../types";
import {
  Badge,
  Card,
  EmptyState,
  MiniStats,
  Notice,
  Segmented,
  Spinner,
  Stat,
} from "../components/ui";

const TMS_URL = "https://tms.nepse.com.np/";

function parseNumber(text: string): number | null {
  const cleaned = text.replace(/,/g, "").trim();
  if (cleaned === "") return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

function today(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function formatDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : "—";
}

interface PlanDraft {
  symbol: string;
  side: TradeSide;
  entry: string;
  stop: string;
  targets: string[];
  quantity: string;
  riskMode: "amount" | "percent";
  riskAmount: string;
  riskPercent: string;
  capital: string;
  holdingDays: string;
  notes: string;
}

const EMPTY_DRAFT: PlanDraft = {
  symbol: "",
  side: "buy",
  entry: "",
  stop: "",
  targets: ["", "", ""],
  quantity: "",
  riskMode: "amount",
  riskAmount: "",
  riskPercent: "",
  capital: "100000",
  holdingDays: "365",
  notes: "",
};

export function TradePlanPage() {
  const companiesState = useApi<CompaniesResponse>("/api/companies");
  const [listFilter, setListFilter] = useState("");
  const listPath = useMemo(() => {
    const symbol = listFilter.trim().toUpperCase();
    return symbol
      ? `/api/trade-plans?symbol=${encodeURIComponent(symbol)}`
      : "/api/trade-plans";
  }, [listFilter]);
  const plansState = useApi<TradePlansResponse>(listPath);

  const [draft, setDraft] = useState<PlanDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // The saved risk amount can be the value the API derived from the levels.
  // Sending it back unchanged after the levels are edited would freeze a stale
  // number, so only an amount the user typed is treated as an explicit input.
  const [riskAmountDirty, setRiskAmountDirty] = useState(false);

  const companies = companiesState.data?.companies ?? [];
  const plans = plansState.data?.plans ?? [];

  const update = (patch: Partial<PlanDraft>) =>
    setDraft((current) => ({ ...current, ...patch }));

  const updateTarget = (index: number, value: string) =>
    setDraft((current) => ({
      ...current,
      targets: current.targets.map((target, i) => (i === index ? value : target)),
    }));

  const symbol = draft.symbol.trim().toUpperCase();
  const selectedCompany = companies.find((company) => company.symbol === symbol);

  const entry = parseNumber(draft.entry);
  const stop = parseNumber(draft.stop);
  const quantity = parseNumber(draft.quantity);
  const riskAmountInput = parseNumber(draft.riskAmount);
  const riskPercentInput = parseNumber(draft.riskPercent);
  const capital = parseNumber(draft.capital);
  const holdingDays = parseNumber(draft.holdingDays);
  const hasHoldingDays = holdingDays !== null && holdingDays >= 0;
  // The same fallback the fee calculation uses, so the displayed CGT rate can
  // never disagree with the CGT charged in the target table.
  const cgtHoldingDays = hasHoldingDays && holdingDays !== null ? holdingDays : 365;
  const targetValues = draft.targets
    .map(parseNumber)
    .filter((value): value is number => value !== null);

  const isBuy = draft.side === "buy";
  const riskPerShare =
    entry !== null && stop !== null
      ? isBuy
        ? entry - stop
        : stop - entry
      : null;
  const risk =
    riskPerShare !== null && quantity !== null
      ? riskPerShare * quantity
      : null;
  const stopOnWrongSide = riskPerShare !== null && riskPerShare <= 0;

  const resolvedRiskAmount =
    draft.riskMode === "amount"
      ? riskAmountInput
      : riskPercentInput !== null && capital !== null
        ? (capital * riskPercentInput) / 100
        : null;
  const suggestedQuantity =
    resolvedRiskAmount !== null &&
    riskPerShare !== null &&
    riskPerShare > 0
      ? Math.floor(resolvedRiskAmount / riskPerShare)
      : null;

  const buy: BuyCostResult | null =
    isBuy &&
    quantity !== null &&
    quantity > 0 &&
    entry !== null &&
    entry >= 0
      ? buyCost({ quantity, price: entry })
      : null;

  // A sell plan has no known purchase cost here, so the planned entry is used
  // as the reference cost basis and every figure is labelled against entry.
  const costBasis =
    buy?.total ??
    (!isBuy && entry !== null && quantity !== null ? entry * quantity : null);

  const targetRows = useMemo(
    () =>
      targetValues.map((target) => {
        const reward =
          entry !== null && quantity !== null
            ? (isBuy ? target - entry : entry - target) * quantity
            : null;
        const rewardRisk =
          reward !== null && risk !== null && risk > 0 ? reward / risk : null;
        const proceeds =
          target >= 0 &&
          costBasis !== null &&
          quantity !== null &&
          quantity > 0 &&
          costBasis >= 0
            ? sellProceeds({
                quantity,
                price: target,
                buyCostTotal: costBasis,
                holdingDays: cgtHoldingDays,
                investor: "individual",
              })
            : null;
        return { target, reward, rewardRisk, proceeds };
      }),
    [targetValues, entry, quantity, isBuy, risk, costBasis, cgtHoldingDays],
  );

  const firstTarget = targetValues[0];
  const firstTargetReward =
    firstTarget !== undefined && entry !== null && quantity !== null
      ? (isBuy ? firstTarget - entry : entry - firstTarget) * quantity
      : null;
  const firstRewardRisk =
    firstTargetReward !== null && risk !== null && risk > 0
      ? firstTargetReward / risk
      : null;

  const estimatedFees =
    buy?.fees ??
    (entry !== null && entry >= 0 && quantity !== null && quantity > 0
      ? sellProceeds({
          quantity,
          price: entry,
          buyCostTotal: entry * quantity,
          holdingDays: cgtHoldingDays,
          investor: "individual",
        }).fees
      : null);

  const finalRiskAmount = resolvedRiskAmount ?? risk;
  const finalRiskPercent =
    draft.riskMode === "percent" ? riskPercentInput : null;

  const orderText = useMemo(() => {
    if (!symbol || entry === null || quantity === null) return "";
    const lines = [
      "NEPSE equity order (manual entry)",
      `Symbol: ${symbol}`,
      `Side: ${draft.side.toUpperCase()}`,
      `Quantity: ${formatNumber(quantity, Number.isInteger(quantity) ? 0 : 2)}`,
      `Limit price: NPR ${formatNumber(entry)}`,
      stop !== null ? `Stop / risk level: NPR ${formatNumber(stop)}` : null,
      targetValues.length > 0
        ? `Targets: ${targetValues.map((value) => formatNumber(value)).join(", ")}`
        : null,
      draft.notes.trim() ? `Notes: ${draft.notes.trim()}` : null,
      `Prepared: ${today()}`,
    ];
    return lines.filter((line): line is string => line !== null).join("\n");
  }, [symbol, entry, quantity, draft.side, draft.notes, stop, targetValues]);

  function resetForm() {
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
    setError(null);
    setRiskAmountDirty(false);
  }

  function loadPlan(plan: TradePlan) {
    setEditingId(plan.id);
    setError(null);
    setRiskAmountDirty(false);
    setDraft({
      symbol: plan.symbol,
      side: plan.side,
      entry: String(plan.entry),
      stop: String(plan.stop),
      targets: [0, 1, 2].map((index) => {
        const target = plan.targets[index];
        return target === undefined ? "" : String(target);
      }),
      quantity: String(plan.quantity),
      // The API may store a stop-distance percent when none was supplied, so
      // edit in amount mode and let the server derive its own percent again.
      riskMode: "amount",
      riskAmount: plan.riskAmount === null ? "" : String(plan.riskAmount),
      riskPercent: "",
      capital: "",
      holdingDays: "365",
      notes: plan.notes ?? "",
    });
  }

  async function savePlan(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!symbol) {
      setError("Enter a symbol.");
      return;
    }
    if (entry === null || entry <= 0) {
      setError("Entry must be a price above zero.");
      return;
    }
    if (stop === null || stop <= 0) {
      setError("Stop must be a price above zero.");
      return;
    }
    if (riskPerShare === null || riskPerShare <= 0) {
      setError(
        isBuy
          ? "For a buy plan the stop must be below the entry."
          : "For a sell plan the stop must be above the entry.",
      );
      return;
    }
    if (quantity === null || quantity <= 0) {
      setError("Quantity must be above zero.");
      return;
    }
    if (!Number.isInteger(quantity)) {
      setError("Quantity must be a whole number of shares.");
      return;
    }
    if (targetValues.length === 0) {
      setError("Enter at least one target.");
      return;
    }
    if (
      draft.riskMode === "percent" &&
      (riskPercentInput === null ||
        riskPercentInput < 0 ||
        capital === null ||
        capital <= 0)
    ) {
      setError("Risk percent needs a percent of zero or more and account capital above zero.");
      return;
    }
    if (
      draft.riskMode === "amount" &&
      riskAmountInput !== null &&
      riskAmountInput < 0
    ) {
      setError("Risk amount cannot be negative.");
      return;
    }
    for (const target of targetValues) {
      if (target <= 0) {
        setError("Every target must be a price above zero.");
        return;
      }
      if (isBuy ? target <= entry : target >= entry) {
        setError(
          isBuy
            ? "Buy targets must be above the entry."
            : "Sell targets must be below the entry.",
        );
        return;
      }
    }
    setBusy(true);
    try {
      // In percent mode the amount is capital × percent. In amount mode only a
      // value the user typed is an explicit input; otherwise the API derives it
      // from the (possibly edited) levels instead of storing a loaded value.
      const riskAmountToSend =
        draft.riskMode === "percent" || riskAmountDirty
          ? finalRiskAmount
          : null;
      const body = {
        symbol,
        side: draft.side,
        entry,
        stop,
        targets: targetValues,
        quantity,
        // Omit derived fields rather than sending null: the store treats an
        // explicit null as a value and only recomputes when the key is absent.
        ...(riskAmountToSend !== null ? { riskAmount: riskAmountToSend } : {}),
        ...(finalRiskPercent !== null ? { riskPercent: finalRiskPercent } : {}),
        rewardRisk: firstRewardRisk,
        fees: estimatedFees,
        notes: draft.notes.trim() || null,
      };
      if (editingId === null) {
        await api<TradePlan>("/api/trade-plans", {
          method: "POST",
          body: JSON.stringify(body),
        });
      } else {
        await api<TradePlan>(`/api/trade-plans/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      plansState.reload();
      resetForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function deletePlan(id: number) {
    setBusy(true);
    setError(null);
    try {
      await api(`/api/trade-plans/${id}`, { method: "DELETE" });
      plansState.reload();
      if (editingId === id) resetForm();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function copyOrder() {
    if (!orderText) return;
    try {
      await navigator.clipboard.writeText(orderText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="stack">
      <Notice>
        This is a planning tool. No broker connection is configured, no order is
        sent and no credentials are stored. Copy the order summary and place it
        yourself with your broker or through NEPSE TMS.
      </Notice>

      <Card
        title={editingId === null ? "New trade plan" : `Edit plan #${editingId}`}
        subtitle="Position sizing, risk/reward and estimated NEPSE costs"
        action={
          editingId !== null ? (
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={resetForm}
            >
              Cancel edit
            </button>
          ) : undefined
        }
      >
        <form className="stack" onSubmit={(event) => void savePlan(event)}>
          <div className="form-grid">
            <label>
              <span>Symbol</span>
              <input
                value={draft.symbol}
                required
                list="trade-plan-symbols"
                autoComplete="off"
                placeholder="NABIL"
                onChange={(event) =>
                  update({ symbol: event.target.value.toUpperCase() })
                }
              />
              <datalist id="trade-plan-symbols">
                {companies.map((company) => (
                  <option key={company.symbol} value={company.symbol}>
                    {company.name}
                  </option>
                ))}
              </datalist>
              {selectedCompany && (
                <span className="cell-sub">{selectedCompany.name}</span>
              )}
            </label>
            <div className="field-group">
              <span>Side</span>
              <Segmented
                value={draft.side}
                onChange={(side) => update({ side })}
                items={[
                  { value: "buy", label: "Buy" },
                  { value: "sell", label: "Sell" },
                ]}
                label="Plan side"
              />
            </div>
            <label>
              <span>Entry (NPR)</span>
              <input
                value={draft.entry}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                onChange={(event) => update({ entry: event.target.value })}
              />
            </label>
            <label>
              <span>Stop (NPR)</span>
              <input
                value={draft.stop}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0.00"
                onChange={(event) => update({ stop: event.target.value })}
              />
            </label>
            <label>
              <span>Target 1 (NPR)</span>
              <input
                value={draft.targets[0] ?? ""}
                inputMode="decimal"
                autoComplete="off"
                onChange={(event) => updateTarget(0, event.target.value)}
              />
            </label>
            <label>
              <span>Target 2 (optional)</span>
              <input
                value={draft.targets[1] ?? ""}
                inputMode="decimal"
                autoComplete="off"
                onChange={(event) => updateTarget(1, event.target.value)}
              />
            </label>
            <label>
              <span>Target 3 (optional)</span>
              <input
                value={draft.targets[2] ?? ""}
                inputMode="decimal"
                autoComplete="off"
                onChange={(event) => updateTarget(2, event.target.value)}
              />
            </label>
            <label>
              <span>Quantity</span>
              <input
                value={draft.quantity}
                inputMode="numeric"
                autoComplete="off"
                placeholder="0"
                onChange={(event) => update({ quantity: event.target.value })}
              />
              {suggestedQuantity !== null && suggestedQuantity > 0 && (
                <span className="cell-sub">
                  Risk-based size: {suggestedQuantity.toLocaleString()} shares
                  {" "}
                  <button
                    type="button"
                    className="button button-ghost button-small"
                    onClick={() => update({ quantity: String(suggestedQuantity) })}
                  >
                    Use
                  </button>
                </span>
              )}
            </label>
            <div className="field-group">
              <span>Risk input</span>
              <Segmented
                value={draft.riskMode}
                onChange={(riskMode) => update({ riskMode })}
                items={[
                  { value: "amount", label: "Amount" },
                  { value: "percent", label: "Percent" },
                ]}
                label="Risk input mode"
              />
            </div>
            {draft.riskMode === "amount" ? (
              <label>
                <span>Risk amount (NPR)</span>
                <input
                  value={draft.riskAmount}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="Optional"
                  onChange={(event) => {
                    setRiskAmountDirty(true);
                    update({ riskAmount: event.target.value });
                  }}
                />
              </label>
            ) : (
              <>
                <label>
                  <span>Risk percent (%)</span>
                  <input
                    value={draft.riskPercent}
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder="1"
                    onChange={(event) =>
                      update({ riskPercent: event.target.value })
                    }
                  />
                </label>
                <label>
                  <span>Account capital (NPR)</span>
                  <input
                    value={draft.capital}
                    inputMode="decimal"
                    autoComplete="off"
                    onChange={(event) => update({ capital: event.target.value })}
                  />
                </label>
              </>
            )}
            <label>
              <span>Holding days (for CGT)</span>
              <input
                value={draft.holdingDays}
                inputMode="numeric"
                autoComplete="off"
                onChange={(event) =>
                  update({ holdingDays: event.target.value })
                }
              />
            </label>
            <label className="span-full">
              <span>Notes</span>
              <textarea
                value={draft.notes}
                rows={2}
                placeholder="Setup, trigger, invalidation"
                onChange={(event) => update({ notes: event.target.value })}
              />
            </label>
          </div>

          {stopOnWrongSide && (
            <Notice tone="warn">
              {isBuy
                ? "The stop is at or above the entry, so the risk is zero or negative."
                : "The stop is at or below the entry, so the risk is zero or negative."}
            </Notice>
          )}

          <div className="stats-row">
            <Stat
              label="Risk per trade"
              value={risk === null ? "—" : formatNumber(risk)}
              hint={
                riskPerShare === null
                  ? "needs entry and stop"
                  : `${formatNumber(riskPerShare)} per share`
              }
            />
            <Stat
              label="Reward / risk"
              value={
                firstRewardRisk === null
                  ? "—"
                  : `${formatNumber(firstRewardRisk)}×`
              }
              hint="first target"
            />
            <Stat
              label={isBuy ? "Estimated buy cost" : "Estimated sell fees"}
              value={
                isBuy
                  ? buy === null
                    ? "—"
                    : formatNumber(buy.total)
                  : estimatedFees === null
                    ? "—"
                    : formatNumber(estimatedFees)
              }
              hint={
                isBuy && buy !== null
                  ? `fees ${formatNumber(buy.fees)} · ${formatNumber(buy.costPerShare)}/share`
                  : isBuy
                    ? "needs entry and quantity"
                    : "at planned entry"
              }
            />
            <Stat
              label="Risk amount used"
              value={
                finalRiskAmount === null ? "—" : formatNumber(finalRiskAmount)
              }
              hint={
                draft.riskMode === "percent" && finalRiskPercent !== null
                  ? `${formatNumber(finalRiskPercent)}% of capital`
                  : "risk amount"
              }
            />
          </div>

          {targetRows.length > 0 && entry !== null && quantity !== null && (
            <div className="table-scroll">
              <table className="table">
                <caption className="sr-only">
                  Target reward, risk and estimated net profit
                </caption>
                <thead>
                  <tr>
                    <th>Target</th>
                    <th className="right">Reward</th>
                    <th className="right">R multiple</th>
                    <th className="right">Sell amount</th>
                    <th className="right">Sell fees</th>
                    <th className="right">CGT</th>
                    <th className="right">
                      {isBuy ? "Net profit" : "Net vs entry"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {targetRows.map((row, index) => (
                    <tr key={`${row.target}-${index}`}>
                      <td className="mono">{formatNumber(row.target)}</td>
                      <td
                        className={`right ${
                          row.reward === null
                            ? ""
                            : row.reward >= 0
                              ? "tone-up"
                              : "tone-down"
                        }`}
                      >
                        {formatNumber(row.reward)}
                      </td>
                      <td className="right">
                        {row.rewardRisk === null
                          ? "—"
                          : `${formatNumber(row.rewardRisk)}×`}
                      </td>
                      <td className="right">
                        {formatNumber(row.proceeds?.amount)}
                      </td>
                      <td className="right">
                        {formatNumber(row.proceeds?.fees)}
                      </td>
                      <td className="right">{formatNumber(row.proceeds?.cgt)}</td>
                      <td
                        className={`right ${
                          row.proceeds === null
                            ? ""
                            : row.proceeds.netProfit >= 0
                              ? "tone-up"
                              : "tone-down"
                        }`}
                      >
                        {formatNumber(row.proceeds?.netProfit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <MiniStats
            items={[
              {
                label: "Buy fees",
                value: formatNumber(buy?.fees),
                hint: "commission, SEBON, DP",
              },
              {
                label: "CGT rate",
                value: `${formatNumber(cgtHoldingDays >= 365 ? 5 : 7.5)}%`,
                hint: cgtHoldingDays >= 365 ? "long term" : "short term",
              },
              {
                label: "Cost basis",
                value: formatNumber(costBasis),
                hint: isBuy ? "buy total" : "entry × quantity",
              },
              {
                label: "Targets",
                value: String(targetValues.length),
                hint: "1 to 3",
              },
            ]}
          />

          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button className="button" type="submit" disabled={busy}>
              {busy
                ? "Saving…"
                : editingId === null
                  ? "Save plan"
                  : "Update plan"}
            </button>
            <button
              type="button"
              className="button button-ghost"
              disabled={busy}
              onClick={resetForm}
            >
              Clear
            </button>
          </div>
          <p className="muted small">
            Costs use the bundled NEPSE fee schedule (broker commission bands,
            SEBON fee, DP charge). CGT is shown for an individual holder at the
            holding period above. Estimates only; confirm the rates with your
            broker. A sell plan uses the planned entry as the reference cost
            basis because the app does not know your purchase history here.
          </p>
        </form>
      </Card>

      <Card
        title="Prepare order"
        subtitle="Manual order sheet; nothing is transmitted"
        action={
          orderText ? (
            <div className="card-actions">
              <button
                type="button"
                className="button button-ghost button-small"
                onClick={() => void copyOrder()}
              >
                {copied ? "Copied" : "Copy order"}
              </button>
              <a
                className="button button-ghost button-small"
                href={TMS_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open NEPSE TMS
              </a>
            </div>
          ) : undefined
        }
      >
        {orderText ? (
          <>
            <pre className="order-sheet">{orderText}</pre>
            <p className="muted small">
              No direct broker execution is connected. Paste this order into your
              broker terminal or NEPSE TMS yourself. The link opens the exchange
              TMS in a new tab; this app sends nothing to it.
            </p>
          </>
        ) : (
          <EmptyState title="Complete the symbol, entry and quantity">
            The order summary appears once there is enough to describe an order.
          </EmptyState>
        )}
      </Card>

      <Card
        title="Saved plans"
        subtitle={`${plans.length} plan${plans.length === 1 ? "" : "s"}`}
        action={
          <div className="card-actions">
            <input
              type="search"
              placeholder="Filter symbol"
              aria-label="Filter plans by symbol"
              value={listFilter}
              onChange={(event) => setListFilter(event.target.value.toUpperCase())}
            />
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={plansState.reload}
            >
              Refresh
            </button>
          </div>
        }
      >
        {plansState.loading && !plansState.data ? (
          <Spinner label="Loading saved plans" />
        ) : plansState.error ? (
          <EmptyState title="Could not load trade plans">
            {plansState.error}
          </EmptyState>
        ) : plans.length === 0 ? (
          <EmptyState title="No saved plans">
            Save a plan above to keep it with your journal.
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Side</th>
                  <th className="right">Entry</th>
                  <th className="right">Stop</th>
                  <th className="right">Targets</th>
                  <th className="right">Qty</th>
                  <th className="right">Risk</th>
                  <th className="right">R:R</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.id}>
                    <td>
                      <strong>{plan.symbol}</strong>
                      {plan.notes && (
                        <span className="cell-sub">{plan.notes}</span>
                      )}
                    </td>
                    <td>
                      <Badge tone={plan.side === "buy" ? "good" : "bad"}>
                        {plan.side}
                      </Badge>
                    </td>
                    <td className="right">{formatNumber(plan.entry)}</td>
                    <td className="right">{formatNumber(plan.stop)}</td>
                    <td className="right">
                      {plan.targets.map((target) => formatNumber(target)).join(" / ") ||
                        "—"}
                    </td>
                    <td className="right">{formatNumber(plan.quantity, 0)}</td>
                    <td className="right">{formatNumber(plan.riskAmount)}</td>
                    <td className="right">
                      {plan.rewardRisk === null
                        ? "—"
                        : `${formatNumber(plan.rewardRisk)}×`}
                    </td>
                    <td className="muted small">{formatDate(plan.createdAt)}</td>
                    <td className="right">
                      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
                        <button
                          type="button"
                          className="button button-ghost button-small"
                          onClick={() => loadPlan(plan)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="button button-ghost button-small"
                          disabled={busy}
                          onClick={() => void deletePlan(plan.id)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted small">
          Plans are stored in your local database. A saved plan can be linked
          from a journal entry.
        </p>
      </Card>
    </div>
  );
}
