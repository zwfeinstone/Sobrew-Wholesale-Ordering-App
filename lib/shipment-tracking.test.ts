import { describe, expect, it } from 'vitest';
import {
  normalizeShipmentTrackingLines,
  parseShipmentTrackingNumbers,
  shipmentTrackingLinesFromFormData,
  shipmentTrackingLinesFromValues,
} from '@/lib/shipment-tracking';

describe('parseShipmentTrackingNumbers', () => {
  it('splits newlines, commas, and semicolons while deduping tracking numbers', () => {
    expect(parseShipmentTrackingNumbers([
      ' 1Z999AA10123456784\n1Z999AA10123456785 ',
      '1Z999AA10123456786, 1z999aa10123456784; 1Z999AA10123456785',
    ])).toEqual([
      '1Z999AA10123456784',
      '1Z999AA10123456785',
      '1Z999AA10123456786',
    ]);
  });
});

describe('shipmentTrackingLinesFromValues', () => {
  it('keeps any number of tracking numbers on one shipment email payload', () => {
    expect(shipmentTrackingLinesFromValues(
      '1Z999AA10123456784\n1Z999AA10123456785\n1Z999AA10123456786\n1Z999AA10123456787\n1Z999AA10123456788',
      { carrier: 'UPS' },
    )).toEqual([
      { carrier: 'UPS', trackingCode: '1Z999AA10123456784' },
      { carrier: 'UPS', trackingCode: '1Z999AA10123456785' },
      { carrier: 'UPS', trackingCode: '1Z999AA10123456786' },
      { carrier: 'UPS', trackingCode: '1Z999AA10123456787' },
      { carrier: 'UPS', trackingCode: '1Z999AA10123456788' },
    ]);
  });
});

describe('shipmentTrackingLinesFromFormData', () => {
  it('builds UPS tracking lines from the manual shipping form field', () => {
    const formData = new FormData();
    formData.append('tracking_numbers', '1Z999AA10123456784, 1Z999AA10123456785');
    formData.append('tracking_numbers', '1Z999AA10123456786');

    expect(shipmentTrackingLinesFromFormData(formData)).toEqual([
      { carrier: 'UPS', trackingCode: '1Z999AA10123456784' },
      { carrier: 'UPS', trackingCode: '1Z999AA10123456785' },
      { carrier: 'UPS', trackingCode: '1Z999AA10123456786' },
    ]);
  });
});

describe('normalizeShipmentTrackingLines', () => {
  it('trims values and removes duplicate tracking cards', () => {
    expect(normalizeShipmentTrackingLines([
      { carrier: ' UPS ', trackingCode: ' 1Z999AA10123456784 ' },
      { carrier: 'UPS', trackingCode: '1z999aa10123456784' },
      { carrier: '', trackingCode: '1Z999AA10123456785', trackingUrl: ' https://track.example/2 ' },
    ])).toEqual([
      { carrier: 'UPS', service: null, trackingCode: '1Z999AA10123456784', trackingUrl: null },
      { carrier: null, service: null, trackingCode: '1Z999AA10123456785', trackingUrl: 'https://track.example/2' },
    ]);
  });
});
