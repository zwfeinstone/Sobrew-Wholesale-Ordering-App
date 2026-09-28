'use client';

import { useId, useState } from 'react';
import PendingSubmitButton from '@/components/pending-submit-button';
import {
  COMPENSATION_TYPES,
  LABOR_WORK_TYPES,
  SALARY_LABOR_WORK_TYPES,
  SALARY_PAY_FREQUENCIES,
  normalizeCompensationType,
  normalizeSalaryLaborWorkType,
  normalizeSalaryPayFrequency,
} from '@/lib/time-clock';

type PayrollCompensationFieldsProps = {
  canEdit: boolean;
  initialCommissionPercent: string;
  initialCompensationType: string;
  initialHourlyRate: string;
  initialIsSalesRep: boolean;
  initialLaborTags: string[];
  initialSalaryAmount: string;
  initialSalaryFrequency: string;
  initialSalaryLaborWorkType: string;
};

export default function PayrollCompensationFields({
  canEdit,
  initialCommissionPercent,
  initialCompensationType,
  initialHourlyRate,
  initialIsSalesRep,
  initialLaborTags,
  initialSalaryAmount,
  initialSalaryFrequency,
  initialSalaryLaborWorkType,
}: PayrollCompensationFieldsProps) {
  const helpId = useId();
  const [compensationType, setCompensationType] = useState(() => normalizeCompensationType(initialCompensationType));
  const [hourlyRate, setHourlyRate] = useState(initialHourlyRate);
  const [salaryAmount, setSalaryAmount] = useState(initialSalaryAmount);
  const [salaryFrequency, setSalaryFrequency] = useState(() => normalizeSalaryPayFrequency(initialSalaryFrequency));
  const [salaryLaborWorkType, setSalaryLaborWorkType] = useState(() => normalizeSalaryLaborWorkType(initialSalaryLaborWorkType));
  const isSalary = compensationType === 'salary';

  return (
    <fieldset disabled={!canEdit} className="min-w-0 space-y-6 disabled:opacity-70">
      <legend className="sr-only">Employee payroll settings</legend>

      <fieldset className="min-w-0 space-y-4">
        <legend className="text-sm font-semibold text-slate-950">Pay</legend>
        <fieldset className="min-w-0 space-y-2">
          <legend className="text-sm font-medium text-slate-700">Pay type</legend>
          <div className="grid max-w-sm grid-cols-2 gap-2">
            {COMPENSATION_TYPES.map((type) => (
              <label
                key={type.value}
                className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border px-4 py-3 text-sm font-semibold transition-colors ${compensationType === type.value ? 'border-teal-300 bg-teal-50 text-teal-900' : 'border-slate-200 bg-white/70 text-slate-700 hover:border-teal-200'}`}
              >
                <input
                  type="radio"
                  name="compensation_type"
                  value={type.value}
                  checked={compensationType === type.value}
                  onChange={() => setCompensationType(type.value)}
                  className="accent-teal-700"
                />
                {type.label}
              </label>
            ))}
          </div>
        </fieldset>

        {isSalary ? (
          <>
            <div className="grid gap-4 md:grid-cols-3">
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span className="block">Salary amount ($)</span>
                <input className="input" name="salary_amount" type="number" min="0" step="0.01" value={salaryAmount} onChange={(event) => setSalaryAmount(event.target.value)} aria-describedby={`${helpId}-pay`} />
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span className="block">Salary amount basis</span>
                <select className="input" name="salary_frequency" value={salaryFrequency} onChange={(event) => setSalaryFrequency(normalizeSalaryPayFrequency(event.target.value))}>
                  {SALARY_PAY_FREQUENCIES.map((frequency) => (
                    <option key={frequency.value} value={frequency.value}>{frequency.label}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-2 text-sm font-medium text-slate-700">
                <span className="block">Salary labor tag</span>
                <select className="input" name="salary_labor_work_type" value={salaryLaborWorkType} onChange={(event) => setSalaryLaborWorkType(normalizeSalaryLaborWorkType(event.target.value))}>
                  {SALARY_LABOR_WORK_TYPES.map((workType) => (
                    <option key={workType.value} value={workType.value}>{workType.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <details className="rounded-xl border border-slate-200 bg-slate-50/60 p-4" open={Number(initialHourlyRate) > 0}>
              <summary className="cursor-pointer text-sm font-semibold text-slate-700">Hourly rate for tracked shifts</summary>
              <label className="mt-3 block max-w-sm space-y-2 text-sm font-medium text-slate-700">
                <span className="block">Hourly rate ($ / hour)</span>
                <input className="input" name="hourly_rate" type="number" min="0" step="0.01" value={hourlyRate} onChange={(event) => setHourlyRate(event.target.value)} aria-describedby={`${helpId}-salary-hourly`} />
              </label>
              <p id={`${helpId}-salary-hourly`} className="mt-2 text-xs leading-relaxed text-slate-500">This rate is saved when the employee clocks in. Tracked shifts add hourly pay separately from salary; use $0 if those shifts should not add hourly pay.</p>
            </details>
          </>
        ) : (
          <>
            <input type="hidden" name="salary_amount" value={salaryAmount} />
            <input type="hidden" name="salary_frequency" value={salaryFrequency} />
            <input type="hidden" name="salary_labor_work_type" value={salaryLaborWorkType} />
            <label className="block max-w-sm space-y-2 text-sm font-medium text-slate-700">
              <span className="block">Hourly rate ($ / hour)</span>
              <input className="input" name="hourly_rate" type="number" min="0" step="0.01" value={hourlyRate} onChange={(event) => setHourlyRate(event.target.value)} aria-describedby={`${helpId}-pay`} />
            </label>
          </>
        )}
        <p id={`${helpId}-pay`} className="text-xs leading-relaxed text-slate-500">
          {isSalary
            ? 'Enter the amount for the frequency selected. Salary is prorated into the payroll date range and assigned to the salary labor tag.'
            : 'The hourly rate is saved with each new shift when the employee clocks in.'}
        </p>
      </fieldset>

      <fieldset className="min-w-0 space-y-3 border-t border-slate-200 pt-4">
        <legend className="pr-3 text-sm font-semibold text-slate-950">Sales commission</legend>
        <div className="grid gap-4 sm:grid-cols-2 sm:items-end">
          <label className="space-y-2 text-sm font-medium text-slate-700">
            <span className="block">Commission rate (%)</span>
            <input className="input" name="commission_percent" type="number" min="0" max="100" step="0.01" defaultValue={initialCommissionPercent} aria-describedby={`${helpId}-commission`} />
          </label>
          <label className="flex min-h-[3.25rem] items-center gap-3 rounded-2xl border border-slate-200 bg-white/65 px-4 py-3 text-sm font-medium text-slate-700">
            <input type="checkbox" name="is_sales_rep" defaultChecked={initialIsSalesRep} className="accent-teal-700" />
            Sales representative
          </label>
        </div>
        <p id={`${helpId}-commission`} className="text-xs leading-relaxed text-slate-500">Commission applies to shipped-order gross profit. The percentage is saved when each order ships.</p>
      </fieldset>

      <fieldset className="min-w-0 space-y-3 border-t border-slate-200 pt-4" aria-describedby={`${helpId}-tags`}>
        <legend className="pr-3 text-sm font-semibold text-slate-950">Labor tags</legend>
        <p id={`${helpId}-tags`} className="text-xs leading-relaxed text-slate-500">Choose the work this employee can track. With multiple tags, they choose a task when clocking in.</p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {LABOR_WORK_TYPES.map((workType) => (
            <label key={workType.value} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white/65 px-4 py-3 text-sm font-medium text-slate-700 has-[:checked]:border-teal-200 has-[:checked]:bg-teal-50 has-[:checked]:text-teal-900">
              <input type="checkbox" name="labor_tag" value={workType.value} defaultChecked={initialLaborTags.includes(workType.value)} className="accent-teal-700" />
              {workType.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
        <p className="text-xs text-slate-500">{canEdit ? 'Changes apply after you save.' : 'You have view-only access to payroll settings.'}</p>
        <PendingSubmitButton className="btn-primary w-full sm:w-auto" disabled={!canEdit} label="Save employee settings" pendingLabel="Saving settings..." />
      </div>
    </fieldset>
  );
}
