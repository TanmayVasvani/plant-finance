import {
  clamp,
  histogram,
  irr,
  mean,
  mirr,
  mulberry32,
  npv,
  payback,
  percentile,
  randn,
  signChanges,
} from "./stats";

export const HORIZON = 5;

export type FactoryInputs = {
  /** ₹ crore, spent at t0. */
  capex: number;
  /** Million brushes a year, nameplate. */
  capacity: number;
  /** Ex-factory price, ₹ per brush. */
  price: number;
  /** Cash variable cost, ₹ per brush. */
  variableCost: number;
  /** ₹ crore per year. */
  fixedCost: number;
  /** Length HORIZON, each in [0, 1]. */
  utilization: number[];
  taxRate: number;
  depYears: number;
  /** NWC as a share of the same year's revenue. Released at exit. */
  nwcPct: number;
  /** Exit salvage as a share of original capex, before tax on the gain. */
  salvagePct: number;
  /** Target debt / capex. Drawn at t0, equal principal, interest on opening balance. */
  debtPct: number;
  costOfDebt: number;
  costOfEquity: number;
};

export type YearRow = {
  year: number;
  utilization: number;
  units: number;
  revenue: number;
  variable: number;
  fixed: number;
  ebitda: number;
  depreciation: number;
  ebit: number;
  interest: number;
  tax: number;
  nopat: number;
  nwc: number;
  deltaNwc: number;
  salvage: number;
  taxOnSalvage: number;
  ufcf: number;
  fcfe: number;
  debtOpen: number;
  principal: number;
  debtClose: number;
  dscr: number | null;
};

export type FactoryResult = {
  years: YearRow[];
  wacc: number;
  npv: number;
  irr: number | null;
  equityIrr: number | null;
  mirr: number | null;
  payback: number | null;
  discountedPayback: number | null;
  pi: number;
  minDscr: number | null;
  equityOutlay: number;
  debtDraw: number;
  ufcf: number[];
  fcfe: number[];
  multipleIrr: boolean;
  bookAtExit: number;
};

export const BASE_FACTORY: FactoryInputs = {
  capex: 18,
  capacity: 24,
  price: 14,
  variableCost: 7.6,
  fixedCost: 4.1,
  utilization: [0.46, 0.64, 0.78, 0.86, 0.9],
  taxRate: 0.25,
  depYears: 10,
  nwcPct: 0.1,
  salvagePct: 0.35,
  debtPct: 0.4,
  costOfDebt: 0.105,
  costOfEquity: 0.15,
};

/** Million units × ₹/unit → ₹ crore. 1 crore = 10 million rupees. */
function toCrore(millionUnits: number, rupeesPerUnit: number): number {
  return (millionUnits * rupeesPerUnit) / 10;
}

export function waccOf(input: FactoryInputs): number {
  const d = clamp(input.debtPct, 0, 0.9);
  return (1 - d) * input.costOfEquity + d * input.costOfDebt * (1 - input.taxRate);
}

export function evaluate(input: FactoryInputs): FactoryResult {
  const debtDraw = input.capex * input.debtPct;
  const equityOutlay = input.capex - debtDraw;
  const wacc = waccOf(input);

  let accumDep = 0;
  let unlevCarry = 0;
  let levCarry = 0;
  let prevNwc = 0;
  let debtOpen = debtDraw;
  const years: YearRow[] = [];

  for (let i = 0; i < HORIZON; i++) {
    const year = i + 1;
    const utilization = clamp(input.utilization[i] ?? 0, 0, 1);
    const units = input.capacity * utilization;
    const revenue = toCrore(units, input.price);
    const variable = toCrore(units, input.variableCost);
    const fixed = input.fixedCost;
    const ebitda = revenue - variable - fixed;
    const depRoom = Math.max(0, input.capex - accumDep);
    const depreciation = Math.min(input.capex / input.depYears, depRoom);
    accumDep += depreciation;
    const ebit = ebitda - depreciation;

    const unlevTaxable = ebit - unlevCarry;
    let unlevTax = 0;
    if (unlevTaxable > 0) {
      unlevTax = unlevTaxable * input.taxRate;
      unlevCarry = 0;
    } else {
      unlevCarry = -unlevTaxable;
    }
    const nopat = ebit - unlevTax;

    const interest = debtOpen * input.costOfDebt;
    const principal = i === HORIZON - 1 ? debtOpen : debtDraw / HORIZON;
    const ebt = ebit - interest;
    const levTaxable = ebt - levCarry;
    let tax = 0;
    if (levTaxable > 0) {
      tax = levTaxable * input.taxRate;
      levCarry = 0;
    } else {
      levCarry = -levTaxable;
    }

    const nwc = year === HORIZON ? 0 : input.nwcPct * revenue;
    const deltaNwc = nwc - prevNwc;
    prevNwc = nwc;

    let salvage = 0;
    let taxOnSalvage = 0;
    if (year === HORIZON) {
      salvage = input.salvagePct * input.capex;
      const book = input.capex - accumDep;
      const gain = salvage - book;
      taxOnSalvage = gain > 0 ? gain * input.taxRate : 0;
    }

    const ufcf = nopat + depreciation - deltaNwc + salvage - taxOnSalvage;
    const netIncome = ebt - tax;
    const fcfe = netIncome + depreciation - principal - deltaNwc + salvage - taxOnSalvage;
    const debtService = interest + principal;
    const dscr = debtService > 1e-8 ? (ebitda - tax) / debtService : null;
    const debtClose = Math.max(0, debtOpen - principal);

    years.push({
      year,
      utilization,
      units,
      revenue,
      variable,
      fixed,
      ebitda,
      depreciation,
      ebit,
      interest,
      tax,
      nopat,
      nwc,
      deltaNwc,
      salvage,
      taxOnSalvage,
      ufcf,
      fcfe,
      debtOpen,
      principal,
      debtClose,
      dscr,
    });
    debtOpen = debtClose;
  }

  const ufcf = [-input.capex, ...years.map((y) => y.ufcf)];
  const fcfe = [-equityOutlay, ...years.map((y) => y.fcfe)];
  const projectNpv = npv(wacc, ufcf);
  const projectIrr = irr(ufcf);
  const equityIrr = irr(fcfe);
  const projectMirr = mirr(ufcf, input.costOfDebt, wacc);
  const pb = payback(ufcf);
  const discounted = ufcf.map((cf, t) => cf / (1 + wacc) ** t);
  const dpb = payback(discounted);
  const pvIn = projectNpv + input.capex;
  const pi = input.capex === 0 ? Number.NaN : pvIn / input.capex;
  const dscrs = years.map((y) => y.dscr).filter((d): d is number => d != null);
  const minDscr = dscrs.length ? Math.min(...dscrs) : null;

  return {
    years,
    wacc,
    npv: projectNpv,
    irr: projectIrr,
    equityIrr,
    mirr: projectMirr,
    payback: pb,
    discountedPayback: dpb,
    pi,
    minDscr,
    equityOutlay,
    debtDraw,
    ufcf,
    fcfe,
    multipleIrr: signChanges(ufcf) > 1,
    bookAtExit: input.capex - accumDep,
  };
}

export type ShockSpec = {
  /** Log volatility of price (median-preserving). */
  priceVol: number;
  /** Arithmetic vol of the utilization multiplier. */
  volumeVol: number;
  /** Correlation of the price shock and the volume shock. */
  priceVolumeCorr: number;
  variableVol: number;
  capexVol: number;
  /** Absolute vol added to the cost of equity. */
  equityVol: number;
  paths: number;
  seed: number;
};

export const BASE_SHOCK: ShockSpec = {
  priceVol: 0.08,
  volumeVol: 0.1,
  priceVolumeCorr: -0.45,
  variableVol: 0.06,
  capexVol: 0.1,
  equityVol: 0.012,
  paths: 2500,
  seed: 20261030,
};

export type SimSummary = {
  npvs: number[];
  meanNpv: number;
  p5: number;
  p50: number;
  p95: number;
  probPositive: number;
  probCovenant: number;
  medianMinDscr: number;
  bins: { x: number; count: number; neg: boolean }[];
};

/**
 * Median-preserving lognormal multiplier: exp(σz) has median 1, so the base case
 * is the median path. (A mean-preserving version would subtract σ²/2 in the
 * exponent; the page describes the median-preserving one, so that is what runs.)
 */
function lognormal(z: number, vol: number): number {
  return Math.exp(vol * z);
}

let baseSimCache: SimSummary | null = null;

export function simulate(input: FactoryInputs, shock: ShockSpec): SimSummary {
  const rand = mulberry32(shock.seed);
  const rho = clamp(shock.priceVolumeCorr, -0.95, 0.95);
  const ortho = Math.sqrt(1 - rho * rho);
  const npvs: number[] = [];
  let positive = 0;
  let covenant = 0;
  const minDscrs: number[] = [];

  for (let p = 0; p < shock.paths; p++) {
    const zPrice = randn(rand);
    const zVol = rho * zPrice + ortho * randn(rand);
    const zCost = randn(rand);
    const zCapex = randn(rand);
    const zKe = randn(rand);
    const price = Math.max(1, input.price * lognormal(zPrice, shock.priceVol));
    const variableCost = Math.max(0.5, input.variableCost * lognormal(zCost, shock.variableVol));
    const capex = input.capex * lognormal(zCapex, shock.capexVol);
    const volMult = 1 + shock.volumeVol * zVol;
    const utilization = input.utilization.map((u) => clamp(u * volMult, 0.05, 1));
    const costOfEquity = Math.max(0.02, input.costOfEquity + shock.equityVol * zKe);
    const result = evaluate({
      ...input,
      price,
      variableCost,
      capex,
      utilization,
      costOfEquity,
    });
    npvs.push(result.npv);
    if (result.npv > 0) positive += 1;
    if (result.minDscr != null) {
      minDscrs.push(result.minDscr);
      if (result.minDscr < 1.25) covenant += 1;
    }
  }

  const sorted = npvs.slice().sort((a, b) => a - b);
  const sortedDscr = minDscrs.slice().sort((a, b) => a - b);
  return {
    npvs: sorted,
    meanNpv: mean(npvs),
    p5: percentile(sorted, 0.05),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    probPositive: positive / shock.paths,
    probCovenant: minDscrs.length ? covenant / minDscrs.length : 0,
    medianMinDscr: percentile(sortedDscr, 0.5),
    bins: histogram(sorted, 28),
  };
}

export function baseSimulation(): SimSummary {
  if (!baseSimCache) baseSimCache = simulate(BASE_FACTORY, BASE_SHOCK);
  return baseSimCache;
}

export type TornadoRow = {
  name: string;
  low: number;
  high: number;
  npvLow: number;
  npvHigh: number;
};

export function tornado(input: FactoryInputs): TornadoRow[] {
  const base = evaluate(input).npv;
  const specs: { name: string; apply: (x: FactoryInputs, dir: -1 | 1) => FactoryInputs }[] = [
    {
      name: "Price",
      apply: (x, dir) => ({ ...x, price: x.price * (1 + dir * 0.1) }),
    },
    {
      name: "Variable cost",
      apply: (x, dir) => ({ ...x, variableCost: x.variableCost * (1 + dir * 0.1) }),
    },
    {
      name: "Utilization",
      apply: (x, dir) => ({
        ...x,
        utilization: x.utilization.map((u) => clamp(u + dir * 0.08, 0.05, 1)),
      }),
    },
    {
      name: "Capex",
      apply: (x, dir) => ({ ...x, capex: x.capex * (1 + dir * 0.1) }),
    },
    {
      name: "Fixed cost",
      apply: (x, dir) => ({ ...x, fixedCost: x.fixedCost * (1 + dir * 0.1) }),
    },
    {
      name: "Cost of equity",
      apply: (x, dir) => ({ ...x, costOfEquity: Math.max(0.02, x.costOfEquity + dir * 0.015) }),
    },
    {
      name: "Debt share",
      apply: (x, dir) => ({ ...x, debtPct: clamp(x.debtPct + dir * 0.1, 0, 0.8) }),
    },
  ];
  const rows = specs.map((spec) => {
    const npvLow = evaluate(spec.apply(input, -1)).npv - base;
    const npvHigh = evaluate(spec.apply(input, 1)).npv - base;
    return {
      name: spec.name,
      low: Math.min(npvLow, npvHigh),
      high: Math.max(npvLow, npvHigh),
      npvLow,
      npvHigh,
    };
  });
  rows.sort((a, b) => Math.abs(b.high - b.low) - Math.abs(a.high - a.low));
  return rows;
}
