type SupabaseLikeError = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

export function logAuthProfileIssue(context: string, error: SupabaseLikeError | null | undefined, userId?: string) {
  console.error(context, {
    userId,
    code: error?.code,
    message: error?.message,
    details: error?.details,
    hint: error?.hint,
  });
}
