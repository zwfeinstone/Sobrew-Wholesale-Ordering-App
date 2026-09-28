export type SingleLeadResult =
  | { ok: true; leadId: string; message: string; href: string; sampleOrderHref?: string }
  | { ok: false; message: string; leadId?: string };
