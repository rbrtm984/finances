import { useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'paycheck-tracker:v1';

const DEFAULT_STATE = {
  bufferVault: 600,
  billsVault: 205,
  sofiBalance: 15260.68,
  rothYTD: 0,
  emergencyFund: 0,
  movingFund: 0,
  settings: {
    bufferGoal: 1000,
    sofiAPR: 0.08,
    sofiMin: 248.81,
    paychecksPerMonth: 2.17,
    defaultPaycheck: 2365,
    phase1BillsAmount: 850,
    phase1BufferContribution: 500,
    phase2BillsAmount: 850,
    phase2SpendingAmount: 800,
    phase3BillsAmount: 600,
    phase3RothAmount: 288,
    phase3EFGoal: 10000,
    phase3FundGoal: 10000,
  },
  history: [],
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_STATE,
      ...parsed,
      settings: { ...DEFAULT_STATE.settings, ...(parsed.settings || {}) },
      history: parsed.history || [],
    };
  } catch {
    return DEFAULT_STATE;
  }
}

const fmt = (n) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const fmt0 = (n) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

function determinePhase(state) {
  if (state.bufferVault < state.settings.bufferGoal) return 1;
  if (state.sofiBalance > 0) return 2;
  return 3;
}

function projectPayoff(balance, apr, monthlyExtra, minimum) {
  if (balance <= 0) return { months: 0, date: null, neverPaysOff: false };
  const monthlyRate = apr / 12;
  const payment = minimum + monthlyExtra;
  let b = balance;
  let months = 0;
  while (b > 0 && months < 1200) {
    const interest = b * monthlyRate;
    if (payment <= interest) return { months: null, date: null, neverPaysOff: true };
    b = b + interest - payment;
    months++;
  }
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return { months, date, neverPaysOff: false };
}

function expectedExtraPerPaycheck(state, phase) {
  const s = state.settings;
  if (phase === 1 || phase === 2) {
    return Math.max(0, s.defaultPaycheck - s.phase2BillsAmount - s.phase2SpendingAmount);
  }
  return 0;
}

function computeAllocation(state, phase, paycheck, options = {}) {
  const s = state.settings;
  if (phase === 1) {
    const bills = s.phase1BillsAmount;
    const bufferRoom = Math.max(0, s.bufferGoal - state.bufferVault);
    const requested = options.bufferContribution ?? s.phase1BufferContribution;
    const buffer = Math.min(requested, bufferRoom, Math.max(0, paycheck - bills));
    const spending = Math.max(0, paycheck - bills - buffer);
    return { bills, buffer, spending, sofiExtra: 0 };
  }
  if (phase === 2) {
    const bills = s.phase2BillsAmount;
    const spending = s.phase2SpendingAmount;
    const rawExtra = Math.max(0, paycheck - bills - spending);
    const sofiExtra = Math.min(rawExtra, state.sofiBalance);
    const leftover = rawExtra - sofiExtra;
    return { bills, spending, sofiExtra, leftover };
  }
  const bills = s.phase3BillsAmount;
  const roth = s.phase3RothAmount;
  let remaining = Math.max(0, paycheck - bills - roth);
  const efRoom = Math.max(0, s.phase3EFGoal - state.emergencyFund);
  const ef = Math.min(remaining, efRoom);
  remaining -= ef;
  const fundRoom = Math.max(0, s.phase3FundGoal - state.movingFund);
  const movingFund = Math.min(remaining, fundRoom);
  remaining -= movingFund;
  return { bills, roth, ef, movingFund, surplus: remaining };
}

export default function App() {
  const [state, setState] = useState(loadState);
  const [showLog, setShowLog] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const phase = determinePhase(state);
  const s = state.settings;
  const bufferPct = Math.min(100, (state.bufferVault / s.bufferGoal) * 100);
  const sofiPaid = 15260.68 - state.sofiBalance;
  const sofiPct = Math.max(0, Math.min(100, (sofiPaid / 15260.68) * 100));

  const projection = useMemo(() => {
    const extraPerPaycheck = expectedExtraPerPaycheck(state, phase);
    const monthlyExtra = extraPerPaycheck * s.paychecksPerMonth;
    return projectPayoff(state.sofiBalance, s.sofiAPR, monthlyExtra, s.sofiMin);
  }, [state, phase, s.paychecksPerMonth, s.sofiAPR, s.sofiMin]);

  function logPaycheck(entry) {
    setState((prev) => {
      const next = { ...prev };
      const a = entry.allocation;
      if (entry.phase === 1) {
        next.bufferVault = Math.min(s.bufferGoal, prev.bufferVault + a.buffer);
        next.billsVault = prev.billsVault + a.bills;
      } else if (entry.phase === 2) {
        next.billsVault = prev.billsVault + a.bills;
        next.sofiBalance = Math.max(0, prev.sofiBalance - a.sofiExtra);
      } else {
        next.billsVault = prev.billsVault + a.bills;
        next.rothYTD = prev.rothYTD + a.roth;
        next.emergencyFund = prev.emergencyFund + a.ef;
        next.movingFund = prev.movingFund + a.movingFund;
      }
      const balancesAfter = {
        bufferVault: next.bufferVault,
        billsVault: next.billsVault,
        sofiBalance: next.sofiBalance,
        rothYTD: next.rothYTD,
        emergencyFund: next.emergencyFund,
        movingFund: next.movingFund,
      };
      next.history = [
        {
          id: Date.now(),
          date: new Date().toISOString(),
          amount: entry.amount,
          phase: entry.phase,
          allocation: a,
          balancesAfter,
        },
        ...prev.history,
      ].slice(0, 50);
      return next;
    });
    setShowLog(false);
  }

  function deleteEntry(id) {
    if (!confirm('Delete this paycheck entry? Vault balances will not be auto-corrected.')) return;
    setState((prev) => ({ ...prev, history: prev.history.filter((h) => h.id !== id) }));
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-2xl px-4 pt-6 pb-24 sm:pt-10">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Paycheck Tracker</h1>
            <p className="text-xs text-neutral-500">
              Phase {phase} ·{' '}
              {phase === 1 ? 'Buffer-building' : phase === 2 ? 'SoFi attack' : 'Post-SoFi'}
            </p>
          </div>
          <button
            onClick={() => setShowSettings(true)}
            className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-800"
          >
            Settings
          </button>
        </header>

        <BufferCard state={state} phase={phase} bufferPct={bufferPct} />

        <SofiCard
          state={state}
          phase={phase}
          sofiPct={sofiPct}
          sofiPaid={sofiPaid}
          projection={projection}
        />

        {phase === 3 && <Phase3Cards state={state} />}

        <RothCard state={state} setState={setState} />

        <RulesCard state={state} phase={phase} />

        <button
          onClick={() => setShowLog(true)}
          className="mt-6 w-full rounded-xl bg-emerald-500 px-6 py-4 text-base font-semibold text-emerald-950 shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 active:scale-[0.99] sm:text-lg"
        >
          Log Paycheck
        </button>

        <HistoryList history={state.history} onDelete={deleteEntry} />
      </div>

      {showLog && (
        <LogPaycheckModal
          state={state}
          phase={phase}
          onClose={() => setShowLog(false)}
          onConfirm={logPaycheck}
        />
      )}
      {showSettings && (
        <SettingsModal
          state={state}
          setState={setState}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

function BufferCard({ state, phase, bufferPct }) {
  const goal = state.settings.bufferGoal;
  const isPrimary = phase === 1;
  return (
    <section
      className={`mb-4 rounded-2xl border p-5 ${
        isPrimary
          ? 'border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-neutral-900'
          : 'border-neutral-800 bg-neutral-900'
      }`}
    >
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-neutral-400">Buffer Vault</h2>
        <span className="text-xs text-neutral-500">goal {fmt0(goal)}</span>
      </div>
      <div className="mb-3 flex items-baseline gap-2">
        <span className={`font-semibold tracking-tight ${isPrimary ? 'text-3xl' : 'text-2xl'}`}>
          {fmt(state.bufferVault)}
        </span>
        <span className="text-sm text-neutral-500">/ {fmt0(goal)}</span>
        {state.bufferVault >= goal && (
          <span className="ml-auto rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-400">
            Funded
          </span>
        )}
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-neutral-800">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            state.bufferVault >= goal ? 'bg-emerald-500' : 'bg-amber-400'
          }`}
          style={{ width: `${bufferPct}%` }}
        />
      </div>
    </section>
  );
}

function SofiCard({ state, phase, sofiPct, sofiPaid, projection }) {
  const isPrimary = phase === 2;
  const monthsLabel =
    projection.neverPaysOff
      ? 'never (payment too low)'
      : projection.months === 0
        ? 'paid off'
        : `${projection.months} mo`;
  const dateLabel = projection.date
    ? projection.date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
    : '—';
  return (
    <section
      className={`mb-4 rounded-2xl border p-5 ${
        isPrimary
          ? 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-neutral-900'
          : 'border-neutral-800 bg-neutral-900'
      }`}
    >
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-neutral-400">SoFi loan</h2>
        <span className="text-xs text-neutral-500">{sofiPct.toFixed(1)}% paid</span>
      </div>
      <div className="mb-3 flex items-baseline gap-2">
        <span className={`font-semibold tracking-tight ${isPrimary ? 'text-3xl' : 'text-2xl'}`}>
          {fmt(state.sofiBalance)}
        </span>
        <span className="text-sm text-neutral-500">remaining</span>
      </div>
      <div className="mb-4 h-2.5 overflow-hidden rounded-full bg-neutral-800">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all duration-500"
          style={{ width: `${sofiPct}%` }}
        />
      </div>
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs uppercase tracking-wider text-neutral-500">Payoff</div>
          <div className="text-lg font-semibold text-neutral-100">{dateLabel}</div>
        </div>
        <div className="text-right">
          <div className="text-xs uppercase tracking-wider text-neutral-500">Time</div>
          <div className="text-lg font-semibold text-neutral-100">{monthsLabel}</div>
        </div>
      </div>
      {phase === 1 && !projection.neverPaysOff && (
        <p className="mt-3 text-xs text-neutral-500">
          Projection assumes Phase 2 extra of{' '}
          {fmt0(expectedExtraPerPaycheck(state, phase))}/paycheck once buffer is full.
        </p>
      )}
    </section>
  );
}

function RothCard({ state, setState }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(state.rothYTD.toString());
  return (
    <section className="mb-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-medium text-neutral-400">Roth IRA YTD</h2>
        <span className="text-xs text-neutral-500">{new Date().getFullYear()}</span>
      </div>
      {editing ? (
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            className="w-32 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-lg"
            autoFocus
          />
          <button
            onClick={() => {
              setState((prev) => ({ ...prev, rothYTD: parseFloat(val) || 0 }));
              setEditing(false);
            }}
            className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-emerald-950"
          >
            Save
          </button>
          <button
            onClick={() => {
              setVal(state.rothYTD.toString());
              setEditing(false);
            }}
            className="rounded-md border border-neutral-700 px-3 py-1.5 text-sm"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => {
            setVal(state.rothYTD.toString());
            setEditing(true);
          }}
          className="flex items-baseline gap-2 text-left"
        >
          <span className="text-2xl font-semibold tracking-tight">{fmt(state.rothYTD)}</span>
          <span className="text-xs text-neutral-500 underline-offset-2 hover:underline">edit</span>
        </button>
      )}
    </section>
  );
}

function Phase3Cards({ state }) {
  const s = state.settings;
  const efPct = Math.min(100, (state.emergencyFund / s.phase3EFGoal) * 100);
  const fundPct = Math.min(100, (state.movingFund / s.phase3FundGoal) * 100);
  return (
    <>
      <section className="mb-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-neutral-400">Emergency Fund</h2>
          <span className="text-xs text-neutral-500">goal {fmt0(s.phase3EFGoal)}</span>
        </div>
        <div className="mb-3 text-2xl font-semibold tracking-tight">{fmt(state.emergencyFund)}</div>
        <div className="h-2 overflow-hidden rounded-full bg-neutral-800">
          <div className="h-full rounded-full bg-sky-400" style={{ width: `${efPct}%` }} />
        </div>
      </section>
      <section className="mb-4 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-neutral-400">Moving Fund</h2>
          <span className="text-xs text-neutral-500">goal {fmt0(s.phase3FundGoal)}</span>
        </div>
        <div className="mb-3 text-2xl font-semibold tracking-tight">{fmt(state.movingFund)}</div>
        <div className="h-2 overflow-hidden rounded-full bg-neutral-800">
          <div className="h-full rounded-full bg-violet-400" style={{ width: `${fundPct}%` }} />
        </div>
      </section>
    </>
  );
}

function RulesCard({ state, phase }) {
  const s = state.settings;
  return (
    <section className="mb-2 rounded-2xl border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="mb-3 text-sm font-medium text-neutral-400">Allocation rules · Phase {phase}</h2>
      <ul className="space-y-1.5 text-sm">
        {phase === 1 && (
          <>
            <Rule label="Bills Vault" value={fmt0(s.phase1BillsAmount)} />
            <Rule label="Buffer Vault" value={`${fmt0(s.phase1BufferContribution)} / paycheck`} />
            <Rule label="Spending" value="remainder" muted />
            <Rule label="Extra to SoFi" value={fmt0(0)} muted />
          </>
        )}
        {phase === 2 && (
          <>
            <Rule label="Bills Vault" value={fmt0(s.phase2BillsAmount)} />
            <Rule label="Spending" value={fmt0(s.phase2SpendingAmount)} />
            <Rule label="Extra to SoFi" value="remainder" highlight />
          </>
        )}
        {phase === 3 && (
          <>
            <Rule label="Bills Vault" value={fmt0(s.phase3BillsAmount)} />
            <Rule label="Roth IRA" value={fmt0(s.phase3RothAmount)} />
            <Rule label="Emergency → Moving" value="remainder" muted />
          </>
        )}
      </ul>
    </section>
  );
}

function Rule({ label, value, muted, highlight }) {
  return (
    <li className="flex items-center justify-between">
      <span className="text-neutral-400">{label}</span>
      <span
        className={`font-medium tabular-nums ${
          highlight ? 'text-emerald-400' : muted ? 'text-neutral-500' : 'text-neutral-100'
        }`}
      >
        {value}
      </span>
    </li>
  );
}

function HistoryList({ history, onDelete }) {
  if (!history.length) {
    return (
      <p className="mt-8 text-center text-sm text-neutral-600">
        No paychecks logged yet. Click "Log Paycheck" when one lands.
      </p>
    );
  }
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-sm font-medium text-neutral-400">Recent paychecks</h2>
      <ul className="space-y-2">
        {history.slice(0, 10).map((h) => (
          <li
            key={h.id}
            className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-neutral-100">{fmt(h.amount)}</div>
                <div className="text-xs text-neutral-500">
                  {new Date(h.date).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}{' '}
                  · Phase {h.phase}
                </div>
              </div>
              <button
                onClick={() => onDelete(h.id)}
                className="text-xs text-neutral-600 hover:text-red-400"
              >
                delete
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-400">
              {h.allocation.bills != null && <Tag label="Bills" v={h.allocation.bills} />}
              {h.allocation.buffer != null && <Tag label="Buffer" v={h.allocation.buffer} />}
              {h.allocation.spending != null && <Tag label="Spend" v={h.allocation.spending} />}
              {h.allocation.sofiExtra != null && (
                <Tag label="SoFi" v={h.allocation.sofiExtra} accent />
              )}
              {h.allocation.roth != null && <Tag label="Roth" v={h.allocation.roth} />}
              {h.allocation.ef != null && <Tag label="EF" v={h.allocation.ef} />}
              {h.allocation.movingFund != null && <Tag label="Move" v={h.allocation.movingFund} />}
              {h.allocation.surplus != null && h.allocation.surplus > 0 && (
                <Tag label="Surplus" v={h.allocation.surplus} />
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Tag({ label, v, accent }) {
  return (
    <span>
      <span className="text-neutral-600">{label} </span>
      <span className={accent ? 'text-emerald-400 tabular-nums' : 'tabular-nums'}>{fmt0(v)}</span>
    </span>
  );
}

function LogPaycheckModal({ state, phase, onClose, onConfirm }) {
  const s = state.settings;
  const [amount, setAmount] = useState(s.defaultPaycheck.toString());
  const [bufferContribution, setBufferContribution] = useState(s.phase1BufferContribution);

  const paycheck = parseFloat(amount) || 0;
  const allocation = computeAllocation(state, phase, paycheck, { bufferContribution });

  const newSofi =
    phase === 2 ? Math.max(0, state.sofiBalance - (allocation.sofiExtra || 0)) : state.sofiBalance;
  const newProjection = useMemo(() => {
    if (phase !== 2) return null;
    const monthlyExtra = allocation.sofiExtra * s.paychecksPerMonth;
    return projectPayoff(newSofi, s.sofiAPR, monthlyExtra, s.sofiMin);
  }, [phase, newSofi, allocation.sofiExtra, s.paychecksPerMonth, s.sofiAPR, s.sofiMin]);

  return (
    <Modal onClose={onClose} title="Log Paycheck">
      <label className="mb-4 block">
        <span className="mb-1 block text-xs uppercase tracking-wider text-neutral-500">
          Net amount
        </span>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500">
            $
          </span>
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            step="0.01"
            className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-7 py-3 text-2xl font-semibold tabular-nums focus:border-emerald-500 focus:outline-none"
            autoFocus
          />
        </div>
      </label>

      {phase === 1 && (
        <div className="mb-4">
          <div className="mb-1 flex items-baseline justify-between">
            <span className="text-xs uppercase tracking-wider text-neutral-500">
              Buffer contribution
            </span>
            <span className="text-sm font-semibold text-amber-400 tabular-nums">
              {fmt0(bufferContribution)}
            </span>
          </div>
          <input
            type="range"
            min="400"
            max="600"
            step="25"
            value={bufferContribution}
            onChange={(e) => setBufferContribution(parseInt(e.target.value, 10))}
            className="w-full accent-amber-400"
          />
          <div className="flex justify-between text-xs text-neutral-600">
            <span>$400</span>
            <span>$600</span>
          </div>
        </div>
      )}

      <div className="mb-4 rounded-xl border border-neutral-800 bg-neutral-950 p-4">
        <div className="mb-2 text-xs uppercase tracking-wider text-neutral-500">
          Allocate this paycheck
        </div>
        <ul className="space-y-1.5 text-sm">
          {allocation.bills != null && <AllocRow label="Bills Vault" v={allocation.bills} />}
          {allocation.buffer != null && (
            <AllocRow label="Buffer Vault" v={allocation.buffer} accent="amber" />
          )}
          {allocation.spending != null && (
            <AllocRow label="Spending (checking)" v={allocation.spending} muted />
          )}
          {allocation.sofiExtra != null && (
            <AllocRow label="Extra to SoFi" v={allocation.sofiExtra} accent="emerald" />
          )}
          {allocation.leftover > 0 && (
            <AllocRow label="Leftover (loan paid off)" v={allocation.leftover} muted />
          )}
          {allocation.roth != null && <AllocRow label="Roth IRA" v={allocation.roth} />}
          {allocation.ef != null && allocation.ef > 0 && (
            <AllocRow label="Emergency Fund" v={allocation.ef} />
          )}
          {allocation.movingFund != null && allocation.movingFund > 0 && (
            <AllocRow label="Moving Fund" v={allocation.movingFund} />
          )}
          {allocation.surplus != null && allocation.surplus > 0 && (
            <AllocRow label="Surplus / invest" v={allocation.surplus} accent="emerald" />
          )}
        </ul>
      </div>

      {phase === 2 && newProjection && (
        <div className="mb-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-sm">
          <div className="text-xs uppercase tracking-wider text-emerald-400/80">After this</div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-neutral-400">SoFi balance</span>
            <span className="font-semibold tabular-nums">{fmt(newSofi)}</span>
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-neutral-400">Payoff</span>
            <span className="font-semibold tabular-nums">
              {newProjection.neverPaysOff
                ? '—'
                : newProjection.date
                  ? `${newProjection.date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} (${newProjection.months} mo)`
                  : 'paid off'}
            </span>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-3 text-sm font-medium text-neutral-300 hover:bg-neutral-800"
        >
          Cancel
        </button>
        <button
          onClick={() => onConfirm({ amount: paycheck, phase, allocation })}
          disabled={paycheck <= 0}
          className="flex-1 rounded-lg bg-emerald-500 px-4 py-3 text-sm font-semibold text-emerald-950 hover:bg-emerald-400 disabled:opacity-40"
        >
          Confirm
        </button>
      </div>
    </Modal>
  );
}

function AllocRow({ label, v, muted, accent }) {
  const color =
    accent === 'amber'
      ? 'text-amber-400'
      : accent === 'emerald'
        ? 'text-emerald-400'
        : muted
          ? 'text-neutral-500'
          : 'text-neutral-100';
  return (
    <li className="flex items-center justify-between">
      <span className="text-neutral-400">{label}</span>
      <span className={`font-semibold tabular-nums ${color}`}>{fmt(v)}</span>
    </li>
  );
}

function SettingsModal({ state, setState, onClose }) {
  const [draft, setDraft] = useState(() => ({
    ...state.settings,
    bufferVault: state.bufferVault,
    billsVault: state.billsVault,
    sofiBalance: state.sofiBalance,
    emergencyFund: state.emergencyFund,
    movingFund: state.movingFund,
  }));

  function update(key, value) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function save() {
    setState((prev) => ({
      ...prev,
      bufferVault: parseFloat(draft.bufferVault) || 0,
      billsVault: parseFloat(draft.billsVault) || 0,
      sofiBalance: parseFloat(draft.sofiBalance) || 0,
      emergencyFund: parseFloat(draft.emergencyFund) || 0,
      movingFund: parseFloat(draft.movingFund) || 0,
      settings: {
        bufferGoal: parseFloat(draft.bufferGoal) || 0,
        sofiAPR: parseFloat(draft.sofiAPR) || 0,
        sofiMin: parseFloat(draft.sofiMin) || 0,
        paychecksPerMonth: parseFloat(draft.paychecksPerMonth) || 0,
        defaultPaycheck: parseFloat(draft.defaultPaycheck) || 0,
        phase1BillsAmount: parseFloat(draft.phase1BillsAmount) || 0,
        phase1BufferContribution: parseFloat(draft.phase1BufferContribution) || 0,
        phase2BillsAmount: parseFloat(draft.phase2BillsAmount) || 0,
        phase2SpendingAmount: parseFloat(draft.phase2SpendingAmount) || 0,
        phase3BillsAmount: parseFloat(draft.phase3BillsAmount) || 0,
        phase3RothAmount: parseFloat(draft.phase3RothAmount) || 0,
        phase3EFGoal: parseFloat(draft.phase3EFGoal) || 0,
        phase3FundGoal: parseFloat(draft.phase3FundGoal) || 0,
      },
    }));
    onClose();
  }

  function resetAll() {
    if (!confirm('Reset everything to starting state? Wipes history and balances.')) return;
    setState(DEFAULT_STATE);
    onClose();
  }

  return (
    <Modal onClose={onClose} title="Settings">
      <Section title="Current balances">
        <Field label="Buffer Vault" k="bufferVault" v={draft.bufferVault} on={update} />
        <Field label="Bills Vault" k="billsVault" v={draft.billsVault} on={update} />
        <Field label="SoFi balance" k="sofiBalance" v={draft.sofiBalance} on={update} />
        <Field label="Emergency Fund" k="emergencyFund" v={draft.emergencyFund} on={update} />
        <Field label="Moving Fund" k="movingFund" v={draft.movingFund} on={update} />
      </Section>
      <Section title="Loan & paycheck">
        <Field label="SoFi APR (e.g. 0.08)" k="sofiAPR" v={draft.sofiAPR} on={update} step="0.001" />
        <Field label="SoFi min payment" k="sofiMin" v={draft.sofiMin} on={update} />
        <Field
          label="Paychecks / month"
          k="paychecksPerMonth"
          v={draft.paychecksPerMonth}
          on={update}
          step="0.01"
        />
        <Field
          label="Default paycheck"
          k="defaultPaycheck"
          v={draft.defaultPaycheck}
          on={update}
        />
        <Field label="Buffer goal" k="bufferGoal" v={draft.bufferGoal} on={update} />
      </Section>
      <Section title="Phase 1 — Buffer-building">
        <Field label="Bills" k="phase1BillsAmount" v={draft.phase1BillsAmount} on={update} />
        <Field
          label="Default buffer contribution"
          k="phase1BufferContribution"
          v={draft.phase1BufferContribution}
          on={update}
        />
      </Section>
      <Section title="Phase 2 — SoFi attack">
        <Field label="Bills" k="phase2BillsAmount" v={draft.phase2BillsAmount} on={update} />
        <Field label="Spending" k="phase2SpendingAmount" v={draft.phase2SpendingAmount} on={update} />
      </Section>
      <Section title="Phase 3 — Post-SoFi">
        <Field label="Bills" k="phase3BillsAmount" v={draft.phase3BillsAmount} on={update} />
        <Field label="Roth contribution" k="phase3RothAmount" v={draft.phase3RothAmount} on={update} />
        <Field label="Emergency fund goal" k="phase3EFGoal" v={draft.phase3EFGoal} on={update} />
        <Field label="Moving fund goal" k="phase3FundGoal" v={draft.phase3FundGoal} on={update} />
      </Section>

      <div className="flex gap-2 pt-2">
        <button
          onClick={resetAll}
          className="rounded-lg border border-red-900/50 bg-red-900/20 px-3 py-2 text-xs text-red-400 hover:bg-red-900/40"
        >
          Reset all
        </button>
        <button
          onClick={onClose}
          className="ml-auto rounded-lg border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm hover:bg-neutral-800"
        >
          Cancel
        </button>
        <button
          onClick={save}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-950 hover:bg-emerald-400"
        >
          Save
        </button>
      </div>
    </Modal>
  );
}

function Section({ title, children }) {
  return (
    <div className="mb-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500">
        {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Field({ label, k, v, on, step }) {
  return (
    <label className="flex items-center justify-between gap-3">
      <span className="text-sm text-neutral-300">{label}</span>
      <input
        type="number"
        value={v}
        onChange={(e) => on(k, e.target.value)}
        step={step || '0.01'}
        inputMode="decimal"
        className="w-32 rounded-md border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-right text-sm tabular-nums focus:border-emerald-500 focus:outline-none"
      />
    </label>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
