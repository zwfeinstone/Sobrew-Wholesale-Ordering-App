import { describe, expect, it } from 'vitest';
import { checkoutSubmitState } from '@/lib/checkout-submit-state';

describe('checkout submit state', () => {
  it('allows checkout when the center has no saved delivery locations', () => {
    expect(checkoutSubmitState({
      hasSelectedLocation: false,
      itemCount: 1,
      locationCount: 0,
      submissionId: 'submission-id',
    })).toMatchObject({
      disabled: false,
      mustChooseLocation: false,
    });
  });

  it('requires a selection only when multiple delivery locations exist', () => {
    expect(checkoutSubmitState({
      hasSelectedLocation: false,
      itemCount: 1,
      locationCount: 2,
      submissionId: 'submission-id',
    })).toMatchObject({
      disabled: true,
      disabledLabel: 'Choose delivery',
      mustChooseLocation: true,
    });
  });
}
);
