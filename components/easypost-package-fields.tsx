'use client';

import { useState } from 'react';

export type EasyPostPackageInput = {
  height?: number | string | null;
  length?: number | string | null;
  weight?: number | string | null;
  width?: number | string | null;
};

type PackageRow = EasyPostPackageInput & {
  key: number;
};

function packageRowFromInput(input: EasyPostPackageInput, index: number): PackageRow {
  return {
    height: input.height ?? '',
    key: index + 1,
    length: input.length ?? '',
    weight: input.weight ?? '',
    width: input.width ?? '',
  };
}

export default function EasyPostPackageFields({
  initialPackages = [{}],
}: {
  initialPackages?: EasyPostPackageInput[];
}) {
  const [nextKey, setNextKey] = useState(() => Math.max(2, initialPackages.length + 1));
  const [packages, setPackages] = useState<PackageRow[]>(() => {
    const rows = initialPackages.length ? initialPackages : [{}];
    return rows.map(packageRowFromInput);
  });

  return (
    <div className="space-y-3">
      {packages.map((packageRow, index) => (
        <div key={packageRow.key} className="rounded-2xl border border-slate-200 bg-white/65 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-semibold text-slate-950">Package {index + 1}</p>
            {packages.length > 1 ? (
              <button
                className="w-fit text-sm font-semibold text-rose-700 hover:text-rose-800"
                type="button"
                onClick={() => setPackages((current) => current.filter((row) => row.key !== packageRow.key))}
              >
                Remove
              </button>
            ) : null}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-2 text-sm font-medium text-slate-700">
              Length (in)
              <input className="input" name="package_length" min="0.01" step="0.01" type="number" required defaultValue={packageRow.length ?? ''} />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              Width (in)
              <input className="input" name="package_width" min="0.01" step="0.01" type="number" required defaultValue={packageRow.width ?? ''} />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              Height (in)
              <input className="input" name="package_height" min="0.01" step="0.01" type="number" required defaultValue={packageRow.height ?? ''} />
            </label>
            <label className="space-y-2 text-sm font-medium text-slate-700">
              Weight (oz)
              <input className="input" name="package_weight" min="0.01" step="0.01" type="number" required defaultValue={packageRow.weight ?? ''} />
            </label>
          </div>
        </div>
      ))}
      <button
        className="btn-secondary w-full sm:w-auto"
        type="button"
        onClick={() => {
          setPackages((current) => [...current, { key: nextKey }]);
          setNextKey((current) => current + 1);
        }}
      >
        Add package
      </button>
    </div>
  );
}
