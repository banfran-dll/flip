import type { ScoredFlip } from './signals';

/**
 * Budget planner: split a budget across at most `slots` concurrent flips to
 * maximise confidence-weighted coins per hour.
 *
 * Under the flip model, profit/h of one item is `units × profit / max(cycle, minCycle)`
 * with `cycle = units / flow`. Below `units* = flow × minCycle` the rate grows
 * linearly with capital; above it the cycle just gets longer and the rate is
 * flat at `profit × flow`. So every item has a capital cap beyond which extra
 * coins earn nothing, and below the cap each coin is worth `density = rateMax / cap`.
 * The optimum is close to "fill the densest items up to their caps"; a swap
 * search then fixes the cases where the slot limit makes a bigger, slightly
 * less dense item the better use of a slot.
 */
export interface PlanInput {
  budget: number;
  /** Concurrent bazaar orders you are willing to dedicate (the game allows 14 by default). */
  slots: number;
  minCycleMinutes: number;
  maxOrderSize: number;
}

export interface PlanCandidate {
  flip: ScoredFlip;
  unitsCap: number;
  capCapital: number;
  /** Confidence-weighted coins/hour when funded up to the cap. */
  rateMax: number;
  density: number;
}

export interface PlanLine {
  id: string;
  flip: ScoredFlip;
  units: number;
  capital: number;
  /** Confidence-weighted coins/hour from this line. */
  ratePerHour: number;
  /** Unweighted (theoretical) coins/hour. */
  rawRatePerHour: number;
  cycleHours: number;
  /** capital ÷ cap capital, 0–1. */
  saturation: number;
}

export interface Plan {
  lines: PlanLine[];
  totalCapital: number;
  totalRatePerHour: number;
  totalRawRatePerHour: number;
  leftover: number;
  slotsUsed: number;
}

const EMPTY_PLAN: Plan = { lines: [], totalCapital: 0, totalRatePerHour: 0, totalRawRatePerHour: 0, leftover: 0, slotsUsed: 0 };

function minCycleHours(input: PlanInput): number {
  return Math.max(1, input.minCycleMinutes) / 60;
}

function rawRate(f: ScoredFlip, units: number, m: number): { rate: number; cycleHours: number } {
  if (units <= 0) return { rate: 0, cycleHours: 0 };
  const cycleHours = units / f.instaSellsPerHour + units / f.instaBuysPerHour;
  return { rate: (units * f.profitPerUnit) / Math.max(cycleHours, m), cycleHours };
}

export function candidate(f: ScoredFlip, input: PlanInput): PlanCandidate | null {
  if (!(f.profitPerUnit > 0) || !(f.flowPerHour > 0) || !(f.buyOrderPrice > 0) || !(f.confidence > 0)) return null;
  const m = minCycleHours(input);
  const unitsCap = Math.max(1, Math.min(Math.floor(f.flowPerHour * m), input.maxOrderSize));
  const capCapital = unitsCap * f.buyOrderPrice;
  const rateMax = rawRate(f, unitsCap, m).rate * f.confidence;
  return { flip: f, unitsCap, capCapital, rateMax, density: rateMax / capCapital };
}

/** Optimal allocation for a fixed set of candidates: densest first, each up to its cap. */
export function allocate(set: PlanCandidate[], input: PlanInput): Plan {
  const m = minCycleHours(input);
  let remaining = input.budget;
  const lines: PlanLine[] = [];
  for (const c of [...set].sort((a, b) => b.density - a.density)) {
    const capital = Math.min(c.capCapital, remaining);
    const units = Math.min(c.unitsCap, Math.floor(capital / c.flip.buyOrderPrice));
    if (units <= 0) continue;
    const spent = units * c.flip.buyOrderPrice;
    const { rate, cycleHours } = rawRate(c.flip, units, m);
    lines.push({
      id: c.flip.id,
      flip: c.flip,
      units,
      capital: spent,
      ratePerHour: rate * c.flip.confidence,
      rawRatePerHour: rate,
      cycleHours,
      saturation: spent / c.capCapital,
    });
    remaining -= spent;
    if (remaining <= 0) break;
  }
  lines.sort((a, b) => b.capital - a.capital);
  const totalCapital = lines.reduce((s, l) => s + l.capital, 0);
  return {
    lines,
    totalCapital,
    totalRatePerHour: lines.reduce((s, l) => s + l.ratePerHour, 0),
    totalRawRatePerHour: lines.reduce((s, l) => s + l.rawRatePerHour, 0),
    leftover: input.budget - totalCapital,
    slotsUsed: lines.length,
  };
}

export const SEARCH_POOL = 80;
export const SEARCH_ROUNDS = 30;

export function planBudget(flips: ScoredFlip[], input: PlanInput): Plan {
  const slots = Math.max(1, Math.floor(input.slots));
  if (!(input.budget > 0)) return { ...EMPTY_PLAN, leftover: Math.max(0, input.budget) };
  const cands = flips
    .map((f) => candidate(f, input))
    .filter((c): c is PlanCandidate => c !== null && c.flip.buyOrderPrice <= input.budget)
    .sort((a, b) => b.density - a.density);
  if (cands.length === 0) return { ...EMPTY_PLAN, leftover: input.budget };

  // Greedy seed.
  let chosen: PlanCandidate[] = [];
  let remaining = input.budget;
  for (const c of cands) {
    if (chosen.length >= slots || remaining < c.flip.buyOrderPrice) continue;
    chosen.push(c);
    remaining -= Math.min(c.capCapital, remaining);
    if (remaining <= 0) break;
  }
  let best = allocate(chosen, input);

  // Swap search over the densest candidates (and the biggest earners, which greedy may skip).
  const pool = [...new Set([...cands.slice(0, SEARCH_POOL), ...[...cands].sort((a, b) => b.rateMax - a.rateMax).slice(0, SEARCH_POOL)])];
  for (let round = 0; round < SEARCH_ROUNDS; round++) {
    let improved = false;
    for (const j of pool) {
      if (chosen.includes(j)) continue;
      if (chosen.length < slots) {
        const trial = allocate([...chosen, j], input);
        if (trial.totalRatePerHour > best.totalRatePerHour * (1 + 1e-9)) {
          chosen = [...chosen, j];
          best = trial;
          improved = true;
          continue;
        }
      }
      for (const i of chosen) {
        const trial = allocate(chosen.filter((x) => x !== i).concat(j), input);
        if (trial.totalRatePerHour > best.totalRatePerHour * (1 + 1e-9)) {
          chosen = chosen.filter((x) => x !== i).concat(j);
          best = trial;
          improved = true;
          break;
        }
      }
    }
    if (!improved) break;
  }
  return best;
}
