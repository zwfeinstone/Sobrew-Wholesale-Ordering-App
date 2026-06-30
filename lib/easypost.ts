import { env } from '@/lib/env';

const EASYPOST_API_BASE = 'https://api.easypost.com/v2';

export type EasyPostAddressInput = {
  city: string;
  company?: string | null;
  country?: string | null;
  email?: string | null;
  name: string;
  phone?: string | null;
  state: string;
  street1: string;
  street2?: string | null;
  zip: string;
};

export type EasyPostParcelInput = {
  height: number;
  length: number;
  weight: number;
  width: number;
};

export type EasyPostRate = {
  carrier?: string;
  currency?: string;
  delivery_days?: number;
  delivery_date?: string;
  id: string;
  rate: string;
  service?: string;
};

export type EasyPostShipment = {
  id: string;
  object?: string;
  postage_label?: {
    id?: string;
    label_file_type?: string;
    label_pdf_url?: string;
    label_url?: string;
  };
  rates?: EasyPostRate[];
  selected_rate?: EasyPostRate;
  tracker?: {
    public_url?: string;
  };
  tracking_code?: string;
};

export type EasyPostRefund = {
  id: string;
  object?: string;
  status?: string;
  tracking_code?: string;
};

type EasyPostError = {
  error?: {
    code?: string;
    message?: string;
  };
};

function easyPostAuthHeader() {
  return `Basic ${Buffer.from(`${env.easypostApiKey}:`).toString('base64')}`;
}

function cleanAddress(address: EasyPostAddressInput) {
  return {
    city: address.city,
    company: address.company || undefined,
    country: address.country || 'US',
    email: address.email || undefined,
    name: address.name,
    phone: address.phone || undefined,
    state: address.state,
    street1: address.street1,
    street2: address.street2 || undefined,
    zip: address.zip,
  };
}

async function easyPostRequest<T>(path: string, body: unknown): Promise<{ data: T | null; error: string | null }> {
  if (!env.easypostApiKey) {
    return { data: null, error: 'EasyPost API key is not configured.' };
  }

  let response: Response;
  try {
    response = await fetch(`${EASYPOST_API_BASE}${path}`, {
      body: JSON.stringify(body),
      headers: {
        Authorization: easyPostAuthHeader(),
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : 'Unable to reach EasyPost.' };
  }

  const json = await response.json().catch(() => null) as T | EasyPostError | null;
  if (!response.ok) {
    const message = (json as EasyPostError | null)?.error?.message;
    return { data: null, error: message || `EasyPost request failed with status ${response.status}.` };
  }

  return { data: json as T, error: null };
}

export function easyPostRateCents(rate: EasyPostRate | null | undefined) {
  const parsed = Number.parseFloat(String(rate?.rate ?? '0'));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

export function sortEasyPostRates(rates: EasyPostRate[] | null | undefined) {
  return [...(rates ?? [])].sort((a, b) => easyPostRateCents(a) - easyPostRateCents(b) || String(a.carrier ?? '').localeCompare(String(b.carrier ?? '')));
}

export async function createEasyPostShipment({
  fromAddress,
  parcel,
  reference,
  toAddress,
}: {
  fromAddress: EasyPostAddressInput;
  parcel: EasyPostParcelInput;
  reference: string;
  toAddress: EasyPostAddressInput;
}) {
  return easyPostRequest<EasyPostShipment>('/shipments', {
    shipment: {
      from_address: cleanAddress(fromAddress),
      options: {
        label_format: 'PDF',
      },
      parcel,
      reference,
      to_address: cleanAddress(toAddress),
    },
  });
}

export async function buyEasyPostShipment({
  rateId,
  shipmentId,
}: {
  rateId: string;
  shipmentId: string;
}) {
  return easyPostRequest<EasyPostShipment>(`/shipments/${shipmentId}/buy`, {
    rate: {
      id: rateId,
    },
  });
}

export async function refundEasyPostLabels({
  carrier,
  trackingCodes,
}: {
  carrier: string;
  trackingCodes: string[];
}) {
  return easyPostRequest<{ refunds?: EasyPostRefund[] }>('/refunds', {
    refund: {
      carrier,
      tracking_codes: trackingCodes,
    },
  });
}
