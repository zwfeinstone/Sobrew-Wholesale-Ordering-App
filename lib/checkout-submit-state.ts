export type CheckoutSubmitStateInput = {
  hasSelectedLocation: boolean;
  itemCount: number;
  locationCount: number;
  submissionId: string;
};

export function checkoutSubmitState({
  hasSelectedLocation,
  itemCount,
  locationCount,
  submissionId,
}: CheckoutSubmitStateInput) {
  const isCartEmpty = itemCount <= 0;
  const mustChooseLocation = locationCount > 1 && !hasSelectedLocation;
  const disabled = isCartEmpty || mustChooseLocation || !submissionId;
  const disabledLabel = isCartEmpty
    ? 'Add items first'
    : mustChooseLocation
      ? 'Choose delivery'
      : 'Preparing checkout...';

  return {
    disabled,
    disabledLabel,
    mustChooseLocation,
  };
}
