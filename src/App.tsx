import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Field, Key, Method, Metric, Panel, Reading, Reset, StudyHeader } from "./components/bits";
import { ChartBox, Tip, axisLine, tick } from "./components/chart-box";
import { Shell } from "./components/shell";
import {
  BASE_FACTORY,
  BASE_SHOCK,
  evaluate,
  simulate,
  tornado,
  type FactoryInputs,
  type ShockSpec,
} from "./lib/factory";
import { inrCr, pct, rupees, years } from "./lib/format";

export function App() {
  const [input, setInput] = useState<FactoryInputs>(BASE_FACTORY);
  const [shock, setShock] = useState<ShockSpec>(BASE_SHOCK);
  const result = useMemo(() => evaluate(input), [input]);
  const sim = useMemo(() => simulate(input, shock), [input, shock]);
  const swings = useMemo(() => tornado(input), [input]);

  const set = <K extends keyof FactoryInputs>(key: K, value: FactoryInputs[K]) => {
    setInput((prev) => ({ ...prev, [key]: value }));
  };
  const setUtil = (index: number, value: number) => {
    setInput((prev) => {
      const utilization = prev.utilization.slice();
      utilization[index] = value;
      return { ...prev, utilization };
    });
  };

  const tight = result.years.reduce((best, row) =>
    (row.dscr ?? Infinity) < (best.dscr ?? Infinity) ? row : best,
  );
  const yearOne = result.years[0];
  const npvTone = result.npv >= 0 ? "teal" : "rust";
  const dscrTone = result.minDscr != null && result.minDscr < 1.25 ? "rust" : "teal";

  const flow = result.years.map((row) => ({
    year: `Y${row.year}`,
    Revenue: row.revenue,
    EBITDA: row.ebitda,
    "Free cash flow": row.ufcf,
  }));

  return (
    <Shell project="Plant finance">
      <StudyHeader
        kicker="Capital budgeting"
        title="Plant finance"
        lede="A five-year oral-care plant. Twenty-four million brushes of nameplate capacity in the base case, straight-line depreciation, and an equal-principal loan. Unlevered free cash flow is discounted at WACC. Equity cash flow is what remains after debt service. The Monte Carlo moves price, cost, volume, capex and the cost of equity together."
      />

      <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Project NPV"
          value={inrCr(result.npv)}
          hint={`WACC ${pct(result.wacc)} · PI ${result.pi.toFixed(2)}`}
          tone={npvTone}
        />
        <Metric
          label="Project IRR"
          value={pct(result.irr ?? Number.NaN)}
          hint={`MIRR ${pct(result.mirr ?? Number.NaN)} · payback ${years(result.payback)}`}
        />
        <Metric
          label="Equity IRR"
          value={pct(result.equityIrr ?? Number.NaN)}
          hint={`Cheque ${inrCr(result.equityOutlay, 1)} · debt ${inrCr(result.debtDraw, 1)}`}
        />
        <Metric
          label="Minimum DSCR"
          value={result.minDscr == null ? "—" : `${result.minDscr.toFixed(2)}×`}
          hint={`Tightest in year ${tight.year}. Covenant used below is 1.25×.`}
          tone={dscrTone}
        />
      </div>

      <div className="mt-8">
        <Reading title="What this case is saying">
          {result.npv >= 0 ? (
            <>
              At {pct(result.wacc)} the plant is worth {inrCr(result.npv)} today, a profitability
              index of {result.pi.toFixed(2)}.
            </>
          ) : (
            <>
              At {pct(result.wacc)} the plant destroys {inrCr(Math.abs(result.npv))} of value.
            </>
          )}{" "}
          {result.minDscr != null && result.minDscr < 1.25 ? (
            <>
              Debt cover does not clear 1.25×. The minimum is {result.minDscr.toFixed(2)}× in year{" "}
              {tight.year}. Principal would need to be sculpted, or a reserve funded, before a
              lender signed.
            </>
          ) : (
            <>
              Debt cover clears 1.25× in every year of this deterministic path. The minimum is{" "}
              {result.minDscr?.toFixed(2)}× in year {tight.year}.
            </>
          )}{" "}
          {yearOne && yearOne.fcfe < 0 ? (
            <>
              Equity cash flow in year 1 is still {inrCr(yearOne.fcfe)}: working capital and the
              first debt service arrive before the plant is full.
            </>
          ) : (
            <>Year-1 equity cash flow is positive on this path.</>
          )}{" "}
          Across {shock.paths.toLocaleString("en-IN")} draws, NPV is positive in{" "}
          {pct(sim.probPositive, 0)} of paths. The 5th percentile is {inrCr(sim.p5)}. A 1.25×
          covenant breaks in {pct(sim.probCovenant, 0)} of paths.
        </Reading>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-12">
        <div className="lg:col-span-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-2xl">Assumptions</h2>
            <Reset
              onClick={() => {
                setInput(BASE_FACTORY);
                setShock(BASE_SHOCK);
              }}
            />
          </div>
          <Field
            label="Ex-factory price"
            value={input.price}
            min={8}
            max={22}
            step={0.2}
            display={rupees(input.price)}
            onChange={(value) => set("price", value)}
          />
          <Field
            label="Variable cost"
            value={input.variableCost}
            min={4}
            max={14}
            step={0.2}
            display={rupees(input.variableCost)}
            onChange={(value) => set("variableCost", value)}
          />
          <Field
            label="Fixed cost"
            value={input.fixedCost}
            min={1.5}
            max={8}
            step={0.1}
            display={inrCr(input.fixedCost, 1)}
            onChange={(value) => set("fixedCost", value)}
          />
          <Field
            label="Nameplate capacity"
            value={input.capacity}
            min={10}
            max={40}
            step={1}
            display={`${input.capacity.toFixed(0)} m units`}
            onChange={(value) => set("capacity", value)}
          />
          <Field
            label="Capex"
            value={input.capex}
            min={8}
            max={36}
            step={0.5}
            display={inrCr(input.capex, 1)}
            onChange={(value) => set("capex", value)}
          />
          <Field
            label="Debt share of capex"
            value={input.debtPct}
            min={0}
            max={0.75}
            step={0.01}
            display={pct(input.debtPct, 0)}
            onChange={(value) => set("debtPct", value)}
          />
          <Field
            label="Cost of equity"
            value={input.costOfEquity}
            min={0.08}
            max={0.24}
            step={0.005}
            display={pct(input.costOfEquity)}
            onChange={(value) => set("costOfEquity", value)}
          />
          {input.utilization.map((util, index) => (
            <Field
              key={index}
              label={`Utilization, year ${index + 1}`}
              value={util}
              min={0.2}
              max={1}
              step={0.01}
              display={pct(util, 0)}
              onChange={(value) => setUtil(index, value)}
            />
          ))}
          <details className="group border-t border-line py-3">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm text-ink">
              Tax, exit, and the loan rate
            </summary>
            <Field
              label="Cost of debt"
              value={input.costOfDebt}
              min={0.06}
              max={0.16}
              step={0.005}
              display={pct(input.costOfDebt)}
              onChange={(value) => set("costOfDebt", value)}
            />
            <Field
              label="Tax rate"
              value={input.taxRate}
              min={0.15}
              max={0.35}
              step={0.01}
              display={pct(input.taxRate, 0)}
              onChange={(value) => set("taxRate", value)}
            />
            <Field
              label="Depreciation life"
              value={input.depYears}
              min={5}
              max={15}
              step={1}
              display={`${input.depYears.toFixed(0)} yrs`}
              onChange={(value) => set("depYears", value)}
            />
            <Field
              label="Working capital"
              value={input.nwcPct}
              min={0}
              max={0.25}
              step={0.01}
              display={`${pct(input.nwcPct, 0)} of sales`}
              onChange={(value) => set("nwcPct", value)}
            />
            <Field
              label="Salvage"
              value={input.salvagePct}
              min={0}
              max={0.8}
              step={0.05}
              display={`${pct(input.salvagePct, 0)} of capex`}
              onChange={(value) => set("salvagePct", value)}
            />
          </details>
          <details className="group border-t border-line py-3">
            <summary className="flex min-h-11 cursor-pointer items-center text-sm text-ink">
              Monte Carlo shocks
            </summary>
            <Field
              label="Price volatility"
              value={shock.priceVol}
              min={0.02}
              max={0.2}
              step={0.01}
              display={pct(shock.priceVol, 0)}
              onChange={(value) => setShock((prev) => ({ ...prev, priceVol: value }))}
            />
            <Field
              label="Volume volatility"
              value={shock.volumeVol}
              min={0.02}
              max={0.25}
              step={0.01}
              display={pct(shock.volumeVol, 0)}
              onChange={(value) => setShock((prev) => ({ ...prev, volumeVol: value }))}
            />
            <Field
              label="Price–volume correlation"
              value={shock.priceVolumeCorr}
              min={-0.8}
              max={0.4}
              step={0.05}
              display={shock.priceVolumeCorr.toFixed(2)}
              onChange={(value) => setShock((prev) => ({ ...prev, priceVolumeCorr: value }))}
            />
            <Field
              label="Capex overrun vol"
              value={shock.capexVol}
              min={0.02}
              max={0.25}
              step={0.01}
              display={pct(shock.capexVol, 0)}
              onChange={(value) => setShock((prev) => ({ ...prev, capexVol: value }))}
            />
          </details>
        </div>

        <div className="lg:col-span-8">
          <Panel title="Cash flow by year">
            <ChartBox>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={flow} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="var(--color-line)" vertical={false} />
                  <XAxis dataKey="year" tick={tick} axisLine={axisLine} tickLine={false} />
                  <YAxis
                    tick={tick}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(value: number) => value.toFixed(0)}
                    width={36}
                  />
                  <Tooltip
                    content={(props) => (
                      <Tip
                        active={props.active}
                        label={props.label}
                        payload={props.payload?.map((row) => ({
                          name: String(row.name ?? ""),
                          value: Number(row.value),
                        }))}
                        format={(value) => inrCr(value)}
                      />
                    )}
                  />
                  <Bar
                    dataKey="Revenue"
                    fill="var(--color-paper-2)"
                    stroke="var(--color-ink)"
                    isAnimationActive={false}
                  />
                  <Bar dataKey="EBITDA" fill="var(--color-teal)" isAnimationActive={false} />
                  <Bar dataKey="Free cash flow" fill="var(--color-ink)" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </ChartBox>
            <p className="mt-2 text-sm text-muted">
              ₹ crore. Year 5 free cash flow includes after-tax salvage and the release of working
              capital. Revenue is ex-factory, not retail.
            </p>
            <Key
              items={[
                { className: "border border-ink bg-paper-2", label: "Revenue" },
                { className: "bg-teal", label: "EBITDA" },
                { className: "bg-ink", label: "Free cash flow" },
              ]}
            />
          </Panel>
          <div className="mt-10">
            <Panel title="Distribution of project NPV">
              <ChartBox className="h-64 w-full min-w-0 md:h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sim.bins} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke="var(--color-line)" vertical={false} />
                    <XAxis
                      dataKey="x"
                      tick={tick}
                      axisLine={axisLine}
                      tickLine={false}
                      tickFormatter={(value: number) => value.toFixed(0)}
                    />
                    <YAxis tick={tick} axisLine={false} tickLine={false} width={36} />
                    <ReferenceLine x={0} stroke="var(--color-ink)" />
                    <Tooltip
                      content={(props) => (
                        <Tip
                          active={props.active}
                          label={
                            typeof props.label === "number"
                              ? `NPV near ${inrCr(props.label, 1)}`
                              : props.label
                          }
                          payload={props.payload?.map((row) => ({
                            name: "Paths",
                            value: Number(row.value),
                          }))}
                          format={(value) => value.toFixed(0)}
                        />
                      )}
                    />
                    <Bar dataKey="count" isAnimationActive={false}>
                      {sim.bins.map((bin) => (
                        <Cell
                          key={bin.x}
                          fill={bin.neg ? "var(--color-rust)" : "var(--color-teal)"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartBox>
              <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
                <Stat label="Mean" value={inrCr(sim.meanNpv)} />
                <Stat label="5th" value={inrCr(sim.p5)} />
                <Stat label="Median" value={inrCr(sim.p50)} />
                <Stat label="95th" value={inrCr(sim.p95)} />
                <Stat label="P(NPV > 0)" value={pct(sim.probPositive, 0)} />
                <Stat label="P(DSCR < 1.25)" value={pct(sim.probCovenant, 0)} />
              </dl>
            </Panel>
          </div>
        </div>
      </div>

      <div className="mt-12">
        <Panel title="What moves the NPV">
          <ChartBox>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={swings}
                layout="vertical"
                margin={{ top: 8, right: 16, left: 8, bottom: 0 }}
              >
                <CartesianGrid stroke="var(--color-line)" horizontal={false} />
                <XAxis type="number" tick={tick} axisLine={axisLine} tickLine={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={tick}
                  axisLine={false}
                  tickLine={false}
                  width={104}
                />
                <ReferenceLine x={0} stroke="var(--color-ink)" />
                <Tooltip
                  content={(props) => (
                    <Tip
                      active={props.active}
                      label={props.label}
                      payload={props.payload?.map((row) => ({
                        name: String(row.name ?? ""),
                        value: Number(row.value),
                      }))}
                      format={(value) => inrCr(value)}
                    />
                  )}
                />
                <Bar
                  dataKey="npvLow"
                  name="Input down"
                  fill="var(--color-rust)"
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="npvHigh"
                  name="Input up"
                  fill="var(--color-teal)"
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartBox>
          <p className="mt-2 text-sm text-muted">
            Change in NPV, ₹ crore, versus the case on screen. Rust is the input lowered (price,
            cost and capex by 10%; utilization by 8 points; cost of equity by 1.5 points; debt share
            by 10 points). Teal is the same input raised. Price dominates. Debt share barely moves
            project NPV, because WACC already carries the tax shield — it moves equity IRR and the
            covenant instead.
          </p>
        </Panel>
      </div>

      <div className="mt-12">
        <Panel title="Year by year">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[56rem] text-left text-sm">
              <thead className="text-xs tracking-widest text-muted uppercase">
                <tr>
                  {[
                    "Year",
                    "Util.",
                    "Revenue",
                    "EBITDA",
                    "Depreciation",
                    "Interest",
                    "Cash tax",
                    "Δ NWC",
                    "UFCF",
                    "DSCR",
                    "FCFE",
                  ].map((heading) => (
                    <th key={heading} className="py-2 pr-3 font-medium">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="tabular-nums">
                <tr className="border-t border-line">
                  <td className="py-2 pr-3">0</td>
                  <td className="py-2 pr-3">—</td>
                  <td className="py-2 pr-3">—</td>
                  <td className="py-2 pr-3">—</td>
                  <td className="py-2 pr-3">—</td>
                  <td className="py-2 pr-3">—</td>
                  <td className="py-2 pr-3">—</td>
                  <td className="py-2 pr-3">—</td>
                  <td className="py-2 pr-3 text-rust">{inrCr(-input.capex, 2)}</td>
                  <td className="py-2 pr-3">—</td>
                  <td className="py-2 pr-3 text-rust">{inrCr(-result.equityOutlay, 2)}</td>
                </tr>
                {result.years.map((row) => (
                  <tr key={row.year} className="border-t border-line">
                    <td className="py-2 pr-3">{row.year}</td>
                    <td className="py-2 pr-3">{pct(row.utilization, 0)}</td>
                    <td className="py-2 pr-3">{inrCr(row.revenue)}</td>
                    <td className="py-2 pr-3">{inrCr(row.ebitda)}</td>
                    <td className="py-2 pr-3">{inrCr(row.depreciation)}</td>
                    <td className="py-2 pr-3">{inrCr(row.interest)}</td>
                    <td className="py-2 pr-3">{inrCr(row.tax)}</td>
                    <td className="py-2 pr-3">{inrCr(row.deltaNwc)}</td>
                    <td className="py-2 pr-3">{inrCr(row.ufcf)}</td>
                    <td
                      className={`py-2 pr-3 ${row.dscr != null && row.dscr < 1.25 ? "text-rust" : ""}`}
                    >
                      {row.dscr == null ? "—" : `${row.dscr.toFixed(2)}×`}
                    </td>
                    <td className={`py-2 pr-3 ${row.fcfe < 0 ? "text-rust" : ""}`}>
                      {inrCr(row.fcfe)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-muted">
            Discounted payback {years(result.discountedPayback)}. Book value left at exit{" "}
            {inrCr(result.bookAtExit)}.{" "}
            {result.multipleIrr
              ? "Cash flows change sign more than once — treat the IRR as one root, not the root."
              : "Unlevered cash flows change sign once, so the project IRR is unique."}
          </p>
        </Panel>
      </div>

      <div className="mt-8">
        <Method title="Method">
          <p>
            Revenue in ₹ crore equals million units times rupees per unit, divided by ten. EBITDA is
            revenue minus variable cost minus fixed cost. Depreciation is straight line and stops at
            zero book value. Unlevered tax is charged on EBIT with a loss carryforward; it does not
            deduct interest. WACC is the after-tax weighted average of the cost of equity and the
            cost of debt, using the debt share of capex as the weight. That is a target structure,
            not a market-value weight that updates every year.
          </p>
          <p>
            Working capital is a share of that year’s revenue and is released in full in year 5.
            Salvage is a share of original capex. Tax is charged on a gain over remaining book value
            and no tax credit is given on a loss. Debt is drawn at t0 against capex only, repaid in
            equal principal, and interest is charged on the opening balance. DSCR is (EBITDA − cash
            tax) / (interest + principal), which is the same number as (PAT + depreciation +
            interest) / debt service, the ratio Indian term lenders quote. It does not deduct the
            working-capital build, so year 1 can clear the covenant while equity cash flow is still
            negative. A stricter CFADS that nets off ΔNWC would put year-1 cover well under 1× on
            the base case, which is the real argument for a debt-service reserve. Equity funds the
            rest of capex. A negative equity cash flow after t0 is a cheque the sponsor still has to
            write.
          </p>
          <p>
            The Monte Carlo is {shock.paths.toLocaleString("en-IN")} paths from seed {shock.seed}.
            Price, variable cost and capex are median-preserving lognormals. Volume is an arithmetic
            shock, correlated with price, and then capped at the nameplate. The cost of equity is
            shocked in levels. Utilization, fixed cost, tax and the debt contract are not shocked.
            There is no terminal growth.
          </p>
        </Method>
      </div>
    </Shell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-line pt-2">
      <dt className="text-xs tracking-widest text-muted uppercase">{label}</dt>
      <dd className="mt-1 tabular-nums text-ink">{value}</dd>
    </div>
  );
}
