import { describe, expect, it } from "vitest";
import { BASE_FACTORY, BASE_SHOCK, HORIZON, evaluate, simulate, tornado, waccOf } from "./factory";
import { npv } from "./stats";

describe("base case", () => {
  const result = evaluate(BASE_FACTORY);

  it("has a positive NPV and an IRR above WACC", () => {
    expect(result.npv).toBeGreaterThan(0);
    expect(result.irr).not.toBeNull();
    expect(result.irr ?? 0).toBeGreaterThan(result.wacc);
    expect(result.multipleIrr).toBe(false);
  });

  it("IRR zeroes the unlevered NPV", () => {
    expect(npv(result.irr ?? 0, result.ufcf)).toBeCloseTo(0, 6);
  });

  it("profitability index is 1 + NPV / capex", () => {
    expect(result.pi).toBeCloseTo(1 + result.npv / BASE_FACTORY.capex, 10);
  });

  it("WACC is the after-tax target-weight average", () => {
    const d = BASE_FACTORY.debtPct;
    const expected =
      (1 - d) * BASE_FACTORY.costOfEquity +
      d * BASE_FACTORY.costOfDebt * (1 - BASE_FACTORY.taxRate);
    expect(result.wacc).toBeCloseTo(expected, 12);
    expect(waccOf({ ...BASE_FACTORY, debtPct: 0 })).toBeCloseTo(BASE_FACTORY.costOfEquity, 12);
  });

  it("repays the loan in full by the last year", () => {
    const last = result.years[HORIZON - 1];
    expect(last?.debtClose).toBeCloseTo(0, 10);
    const principal = result.years.reduce((s, y) => s + y.principal, 0);
    expect(principal).toBeCloseTo(result.debtDraw, 10);
    expect(result.debtDraw + result.equityOutlay).toBeCloseTo(BASE_FACTORY.capex, 10);
  });

  it("releases all working capital at exit", () => {
    const deltas = result.years.reduce((s, y) => s + y.deltaNwc, 0);
    expect(deltas).toBeCloseTo(0, 10);
    expect(result.years[HORIZON - 1]?.nwc).toBe(0);
  });

  it("depreciates straight line and leaves book value at exit", () => {
    const perYear = BASE_FACTORY.capex / BASE_FACTORY.depYears;
    for (const y of result.years) expect(y.depreciation).toBeCloseTo(perYear, 10);
    expect(result.bookAtExit).toBeCloseTo(BASE_FACTORY.capex - HORIZON * perYear, 10);
  });

  it("books salvage, and tax on the gain, only in the last year", () => {
    for (const y of result.years.slice(0, -1)) {
      expect(y.salvage).toBe(0);
      expect(y.taxOnSalvage).toBe(0);
    }
    const last = result.years[HORIZON - 1];
    expect(last?.salvage).toBeCloseTo(BASE_FACTORY.salvagePct * BASE_FACTORY.capex, 10);
    const gain = (last?.salvage ?? 0) - result.bookAtExit;
    expect(last?.taxOnSalvage).toBeCloseTo(gain > 0 ? gain * BASE_FACTORY.taxRate : 0, 10);
  });

  it("DSCR equals (PAT + depreciation + interest) / debt service", () => {
    for (const y of result.years) {
      const pat = y.ebit - y.interest - y.tax;
      const alt = (pat + y.depreciation + y.interest) / (y.interest + y.principal);
      expect(y.dscr).toBeCloseTo(alt, 10);
    }
  });
});

describe("leverage", () => {
  it("with no debt, equity cash flow is the project cash flow", () => {
    const unlevered = evaluate({ ...BASE_FACTORY, debtPct: 0 });
    expect(unlevered.debtDraw).toBe(0);
    expect(unlevered.minDscr).toBeNull();
    for (let t = 0; t < unlevered.ufcf.length; t++) {
      expect(unlevered.fcfe[t]).toBeCloseTo(unlevered.ufcf[t] ?? Number.NaN, 10);
    }
    expect(unlevered.equityIrr).toBeCloseTo(unlevered.irr ?? Number.NaN, 10);
  });

  it("more debt raises equity IRR on a project that earns more than its debt costs", () => {
    const low = evaluate({ ...BASE_FACTORY, debtPct: 0.2 });
    const high = evaluate({ ...BASE_FACTORY, debtPct: 0.6 });
    expect(high.equityIrr ?? 0).toBeGreaterThan(low.equityIrr ?? 0);
    expect(high.minDscr ?? 0).toBeLessThan(low.minDscr ?? 0);
  });
});

describe("Monte Carlo", () => {
  it("is reproducible from the seed", () => {
    const a = simulate(BASE_FACTORY, BASE_SHOCK);
    const b = simulate(BASE_FACTORY, BASE_SHOCK);
    expect(a.npvs).toEqual(b.npvs);
    expect(a.probPositive).toBe(b.probPositive);
  });

  it("returns ordered percentiles and bins that account for every path", () => {
    const s = simulate(BASE_FACTORY, { ...BASE_SHOCK, paths: 600 });
    expect(s.npvs).toHaveLength(600);
    expect(s.p5).toBeLessThanOrEqual(s.p50);
    expect(s.p50).toBeLessThanOrEqual(s.p95);
    expect(s.probPositive).toBeGreaterThan(0);
    expect(s.probPositive).toBeLessThan(1);
    const counted = s.bins.reduce((n, bin) => n + bin.count, 0);
    expect(counted).toBe(600);
  });

  it("collapses onto the base case when every shock is switched off", () => {
    const base = evaluate(BASE_FACTORY).npv;
    const s = simulate(BASE_FACTORY, {
      ...BASE_SHOCK,
      priceVol: 0,
      volumeVol: 0,
      variableVol: 0,
      capexVol: 0,
      equityVol: 0,
      paths: 50,
    });
    expect(s.p50).toBeCloseTo(base, 8);
    expect(s.meanNpv).toBeCloseTo(base, 8);
  });

  it("is centred on the base case: the median path sits near the deterministic NPV", () => {
    const base = evaluate(BASE_FACTORY).npv;
    const s = simulate(BASE_FACTORY, BASE_SHOCK);
    expect(Math.abs(s.p50 - base)).toBeLessThan(0.1 * Math.abs(base) + 0.5);
  });
});

describe("tornado", () => {
  const rows = tornado(BASE_FACTORY);

  it("is sorted by swing, largest first", () => {
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1];
      const cur = rows[i];
      expect((prev?.high ?? 0) - (prev?.low ?? 0)).toBeGreaterThanOrEqual(
        (cur?.high ?? 0) - (cur?.low ?? 0),
      );
    }
  });

  it("keeps low below high and puts price at the top", () => {
    for (const row of rows) expect(row.low).toBeLessThanOrEqual(row.high);
    expect(rows[0]?.name).toBe("Price");
  });
});
