export const toCents = (value: string) => {
  const parsed = Number.parseFloat(value);
  if (Number.isNaN(parsed) || parsed < 0) {
    throw new Error('Invalid price');
  }
  return Math.round(parsed * 100);
};

export const usd = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);
