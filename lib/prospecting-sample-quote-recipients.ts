export const SAMPLE_QUOTE_CC_MAX_RECIPIENTS = 20;
export const SAMPLE_QUOTE_CC_MAX_LENGTH = 6000;

// Accept plain addresses only, so names and pasted mail headers cannot become
// additional recipients. Dots are allowed between, but not within, empty atoms.
const LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

function isPlainEmail(email: string): boolean {
  if (email.length > 254) return false;
  const parts = email.split('@');
  if (parts.length !== 2) return false;
  const [local, domain] = parts;
  const labels = domain.split('.');
  return local.length <= 64 && LOCAL_PART.test(local) && labels.length >= 2 && labels.every(label => DOMAIN_LABEL.test(label));
}

export function validateSampleQuoteCcEmails(value: unknown, recipientEmail: string):
  | { ok: true; ccEmails: string[] }
  | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, ccEmails: [] };
  if (typeof value !== 'string' && !Array.isArray(value)) {
    return { ok: false, error: 'Enter CC email addresses separated by commas, semicolons, or new lines.' };
  }
  const entries: unknown[] = typeof value === 'string' ? value.split(/[,;\r\n]+/) : value;
  if (entries.some(entry => typeof entry !== 'string')) {
    return { ok: false, error: 'Enter a valid email address for every CC recipient.' };
  }
  const rawLength = typeof value === 'string' ? value.length : (entries as string[]).join(', ').length;
  if (rawLength > SAMPLE_QUOTE_CC_MAX_LENGTH) {
    return { ok: false, error: 'The CC list is too long. Enter up to 20 email addresses.' };
  }
  const ccEmails = new Set<string>();
  const primaryRecipient = recipientEmail.trim().toLowerCase();
  for (const entry of entries as string[]) {
    // New lines delimit raw text, but cannot occur inside an array address.
    if (/[\u0000-\u001f\u007f]/.test(entry)) {
      return { ok: false, error: 'Enter a valid email address for every CC recipient.' };
    }
    const email = entry.trim().toLowerCase();
    if (!email) continue;
    if (!isPlainEmail(email)) return { ok: false, error: 'Enter a valid email address for every CC recipient, without names or labels.' };
    if (email !== primaryRecipient) ccEmails.add(email);
  }
  if (ccEmails.size > SAMPLE_QUOTE_CC_MAX_RECIPIENTS) {
    return { ok: false, error: 'You can add up to 20 CC email addresses.' };
  }
  return { ok: true, ccEmails: [...ccEmails] };
}
