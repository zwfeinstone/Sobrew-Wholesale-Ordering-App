export type ShipmentTrackingLine = {
  carrier?: string | null;
  service?: string | null;
  trackingCode: string;
  trackingUrl?: string | null;
};

function cleanText(value: unknown) {
  return String(value ?? '').trim();
}

export function parseShipmentTrackingNumbers(values: unknown | unknown[]) {
  const rawValues = Array.isArray(values) ? values : [values];
  const seen = new Set<string>();
  const trackingNumbers: string[] = [];

  for (const rawValue of rawValues) {
    const candidates = String(rawValue ?? '').split(/[\n,;]+/);
    for (const candidate of candidates) {
      const trackingCode = cleanText(candidate);
      if (!trackingCode) continue;

      const key = trackingCode.toUpperCase();
      if (seen.has(key)) continue;

      seen.add(key);
      trackingNumbers.push(trackingCode);
    }
  }

  return trackingNumbers;
}

export function shipmentTrackingLinesFromValues(
  values: unknown | unknown[],
  defaults: Pick<ShipmentTrackingLine, 'carrier' | 'service'> = {},
) {
  return parseShipmentTrackingNumbers(values).map((trackingCode) => ({
    ...defaults,
    trackingCode,
  }));
}

export function shipmentTrackingLinesFromFormData(
  formData: Pick<FormData, 'getAll'>,
  fieldName = 'tracking_numbers',
) {
  return shipmentTrackingLinesFromValues(formData.getAll(fieldName), { carrier: 'UPS' });
}

export function normalizeShipmentTrackingLines(trackingLines: ShipmentTrackingLine[] = []) {
  const seen = new Set<string>();
  const normalized: ShipmentTrackingLine[] = [];

  for (const tracking of trackingLines) {
    const trackingCode = cleanText(tracking.trackingCode);
    if (!trackingCode) continue;

    const key = trackingCode.toUpperCase();
    if (seen.has(key)) continue;

    seen.add(key);
    normalized.push({
      carrier: cleanText(tracking.carrier) || null,
      service: cleanText(tracking.service) || null,
      trackingCode,
      trackingUrl: cleanText(tracking.trackingUrl) || null,
    });
  }

  return normalized;
}
