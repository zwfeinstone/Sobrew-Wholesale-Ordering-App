'use client';

import { useEffect, useState } from 'react';

type ReportDateRangeFieldsProps = {
  monthValue: string;
  rangeEndValue: string;
  rangeStartValue: string;
};

function rangeForMonth(monthValue: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(monthValue);
  if (!match) return null;

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  if (month < 1 || month > 12) return null;

  const endDay = new Date(year, month, 0).getDate();
  return {
    rangeStart: `${match[1]}-${match[2]}-01`,
    rangeEnd: `${match[1]}-${match[2]}-${String(endDay).padStart(2, '0')}`,
  };
}

export default function ReportDateRangeFields({
  monthValue: initialMonthValue,
  rangeEndValue: initialRangeEndValue,
  rangeStartValue: initialRangeStartValue,
}: ReportDateRangeFieldsProps) {
  const [monthValue, setMonthValue] = useState(initialMonthValue);
  const [rangeStartValue, setRangeStartValue] = useState(initialRangeStartValue);
  const [rangeEndValue, setRangeEndValue] = useState(initialRangeEndValue);

  useEffect(() => {
    setMonthValue(initialMonthValue);
    setRangeStartValue(initialRangeStartValue);
    setRangeEndValue(initialRangeEndValue);
  }, [initialMonthValue, initialRangeEndValue, initialRangeStartValue]);

  function handleMonthChange(value: string) {
    setMonthValue(value);

    const nextRange = rangeForMonth(value);
    if (!nextRange) return;

    setRangeStartValue(nextRange.rangeStart);
    setRangeEndValue(nextRange.rangeEnd);
  }

  return (
    <>
      <label className="space-y-2 text-sm font-medium text-slate-700">
        Report month
        <input
          className="input"
          name="month"
          type="month"
          value={monthValue}
          onChange={(event) => handleMonthChange(event.currentTarget.value)}
        />
      </label>
      <label className="space-y-2 text-sm font-medium text-slate-700">
        Range start
        <input
          className="input"
          name="rangeStart"
          type="date"
          value={rangeStartValue}
          onChange={(event) => setRangeStartValue(event.currentTarget.value)}
        />
      </label>
      <label className="space-y-2 text-sm font-medium text-slate-700">
        Range end
        <input
          className="input"
          name="rangeEnd"
          type="date"
          value={rangeEndValue}
          onChange={(event) => setRangeEndValue(event.currentTarget.value)}
        />
      </label>
    </>
  );
}
