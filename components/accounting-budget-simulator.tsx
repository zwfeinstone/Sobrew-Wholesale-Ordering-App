'use client';

import { useMemo, useState } from 'react';

type SimulatorLine = {
  id: string;
  name: string;
  section: 'revenue' | 'cogs' | 'operating_expenses' | 'other_income' | 'other_expenses';
  amountCents: number;
};

type AccountingBudgetSimulatorProps = {
  lines: SimulatorLine[];
};

const SECTION_LABELS: Record<SimulatorLine['section'], string> = {
  cogs: 'COGS',
  operating_expenses: 'Operating Expenses',
  other_expenses: 'Other Expenses',
  other_income: 'Other Income',
  revenue: 'Revenue',
};

function money(cents: number) {
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    maximumFractionDigits: 0,
    style: 'currency',
  }).format(Math.round(cents / 100));
}

function percent(value: number) {
  return `${Math.round(value * 10) / 10}%`;
}

function dollarsToCents(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function centsToDollars(value: number) {
  return String(Math.round(value / 100));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function totalBySection(lines: SimulatorLine[], section: SimulatorLine['section']) {
  return lines
    .filter((line) => line.section === section)
    .reduce((sum, line) => sum + line.amountCents, 0);
}

export default function AccountingBudgetSimulator({ lines }: AccountingBudgetSimulatorProps) {
  const [scenarioLines, setScenarioLines] = useState<SimulatorLine[]>(lines);
  const [sectionMultipliers, setSectionMultipliers] = useState({
    cogs: 100,
    operating_expenses: 100,
    revenue: 100,
  });
  const [reserveRate, setReserveRate] = useState(8);
  const [profitTargetRate, setProfitTargetRate] = useState(12);

  const totals = useMemo(() => {
    const revenue = totalBySection(scenarioLines, 'revenue');
    const cogs = totalBySection(scenarioLines, 'cogs');
    const operatingExpenses = totalBySection(scenarioLines, 'operating_expenses');
    const otherIncome = totalBySection(scenarioLines, 'other_income');
    const otherExpenses = totalBySection(scenarioLines, 'other_expenses');
    const grossProfit = revenue - cogs;
    const operatingIncome = grossProfit - operatingExpenses;
    const netIncome = operatingIncome + otherIncome - otherExpenses;
    const reserve = Math.round(revenue * (reserveRate / 100));
    const profitTarget = Math.round(revenue * (profitTargetRate / 100));
    const cashAfterPlan = netIncome - reserve;

    return {
      cashAfterPlan,
      cogs,
      grossMargin: revenue > 0 ? (grossProfit / revenue) * 100 : 0,
      grossProfit,
      netIncome,
      operatingExpenses,
      operatingIncome,
      otherExpenses,
      otherIncome,
      profitTarget,
      reserve,
      revenue,
      targetGap: netIncome - profitTarget,
    };
  }, [profitTargetRate, reserveRate, scenarioLines]);

  const maxLineDollars = useMemo(() => {
    const biggest = scenarioLines.reduce((max, line) => Math.max(max, line.amountCents), 0);
    return Math.max(1000, Math.ceil((biggest / 100) * 1.75));
  }, [scenarioLines]);

  function updateLine(lineId: string, amountCents: number) {
    setScenarioLines((current) => current.map((line) => (
      line.id === lineId ? { ...line, amountCents: Math.max(0, amountCents) } : line
    )));
  }

  function scaleSection(section: SimulatorLine['section'], multiplier: number) {
    if (section === 'revenue' || section === 'cogs' || section === 'operating_expenses') {
      setSectionMultipliers((current) => ({ ...current, [section]: Math.round(multiplier * 100) }));
    }
    setScenarioLines((current) => current.map((line) => (
      line.section === section
        ? { ...line, amountCents: Math.round((lines.find((baseLine) => baseLine.id === line.id)?.amountCents ?? line.amountCents) * multiplier) }
        : line
    )));
  }

  function resetScenario() {
    setScenarioLines(lines);
    setSectionMultipliers({
      cogs: 100,
      operating_expenses: 100,
      revenue: 100,
    });
    setReserveRate(8);
    setProfitTargetRate(12);
  }

  return (
    <section className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Scenario Revenue</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{money(totals.revenue)}</p>
          <p className="mt-1 text-sm text-slate-500">Gross margin {percent(totals.grossMargin)}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Net Income</p>
          <p className={`mt-2 text-2xl font-semibold ${totals.netIncome >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{money(totals.netIncome)}</p>
          <p className="mt-1 text-sm text-slate-500">Target gap {money(totals.targetGap)}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Cash Reserve</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{money(totals.reserve)}</p>
          <p className="mt-1 text-sm text-slate-500">After reserve {money(totals.cashAfterPlan)}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Operating Spend</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{money(totals.operatingExpenses)}</p>
          <p className="mt-1 text-sm text-slate-500">COGS {money(totals.cogs)}</p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <div className="card space-y-5">
          <div>
            <span className="eyebrow">Scenario Controls</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Planning levers</h2>
          </div>

          <div className="space-y-4">
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              Revenue growth
              <input
                className="w-full accent-teal-700"
                max="150"
                min="50"
                onChange={(event) => scaleSection('revenue', Number(event.target.value) / 100)}
                step="5"
                type="range"
                value={sectionMultipliers.revenue}
              />
            </label>
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              COGS pressure
              <input
                className="w-full accent-teal-700"
                max="150"
                min="50"
                onChange={(event) => scaleSection('cogs', Number(event.target.value) / 100)}
                step="5"
                type="range"
                value={sectionMultipliers.cogs}
              />
            </label>
            <label className="block space-y-2 text-sm font-medium text-slate-700">
              Operating spend
              <input
                className="w-full accent-teal-700"
                max="150"
                min="50"
                onChange={(event) => scaleSection('operating_expenses', Number(event.target.value) / 100)}
                step="5"
                type="range"
                value={sectionMultipliers.operating_expenses}
              />
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Reserve %
              <input className="input" min="0" max="30" type="number" value={reserveRate} onChange={(event) => setReserveRate(clamp(Number(event.target.value), 0, 30))} />
            </label>
            <label className="space-y-1 text-sm font-medium text-slate-700">
              Profit target %
              <input className="input" min="0" max="40" type="number" value={profitTargetRate} onChange={(event) => setProfitTargetRate(clamp(Number(event.target.value), 0, 40))} />
            </label>
          </div>

          <button className="btn-secondary w-full" type="button" onClick={resetScenario}>
            Reset scenario
          </button>
        </div>

        <div className="card space-y-4">
          <div>
            <span className="eyebrow">Simulator</span>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">Line item budget</h2>
          </div>

          <div className="space-y-3">
            {scenarioLines.map((line) => (
              <div key={line.id} className="grid gap-3 rounded-xl border border-slate-200 bg-white/65 p-3 lg:grid-cols-[minmax(0,1fr)_180px] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-slate-950">{line.name}</p>
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">{SECTION_LABELS[line.section]}</span>
                  </div>
                  <input
                    className="mt-3 w-full accent-teal-700"
                    max={maxLineDollars}
                    min="0"
                    onChange={(event) => updateLine(line.id, dollarsToCents(event.target.value))}
                    step="50"
                    type="range"
                    value={Math.min(Math.round(line.amountCents / 100), maxLineDollars)}
                  />
                </div>
                <label className="space-y-1 text-sm font-medium text-slate-700">
                  Monthly
                  <input
                    className="input"
                    min="0"
                    onChange={(event) => updateLine(line.id, dollarsToCents(event.target.value))}
                    step="1"
                    type="number"
                    value={centsToDollars(line.amountCents)}
                  />
                </label>
              </div>
            ))}
            {!scenarioLines.length ? <p className="text-sm text-slate-500">Categorized accounting activity will appear here after upload.</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}
