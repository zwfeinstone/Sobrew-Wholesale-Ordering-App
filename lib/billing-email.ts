const MAX_BILLING_CC_RECIPIENTS = 20;
const PLAIN_EMAIL = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/** Invoice delivery is explicitly configured independently of the customer's login. */
export function parseBillingEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!email || email.length > 254 || email.split('@')[0].length > 64 || !PLAIN_EMAIL.test(email)) {
    throw new Error('Enter one valid invoice email address. Add any additional recipients in CC.');
  }
  return email;
}

/** Accept the form's address list or the persisted array without silently dropping invalid addresses. */
export function parseBillingEmailCc(value: unknown): string[] {
  if (value == null) return [];
  const values = Array.isArray(value) ? value : [value];
  if (!values.every((entry): entry is string => typeof entry === 'string')) {
    throw new Error('Enter billing CC recipients as plain email addresses.');
  }

  const recipients = new Set<string>();
  for (const entry of values) {
    for (const part of entry.split(/[,;\r\n]+/)) {
      const email = part.trim().toLowerCase();
      if (!email) continue;
      if (email.length > 254 || email.split('@')[0].length > 64 || !PLAIN_EMAIL.test(email)) {
        throw new Error(`Invalid billing CC email address: ${part.trim()}. Use plain email addresses separated by commas, semicolons, or new lines.`);
      }
      recipients.add(email);
      if (recipients.size > MAX_BILLING_CC_RECIPIENTS) {
        throw new Error(`Enter no more than ${MAX_BILLING_CC_RECIPIENTS} billing CC email addresses.`);
      }
    }
  }
  return [...recipients];
}
