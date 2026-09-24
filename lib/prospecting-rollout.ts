import 'server-only';

/** Explicit server configuration wins. Production remains on the legacy workflow until rollout. */
export function isProspectingWorkspaceEnabled() {
  const setting = process.env.PROSPECTING_WORKSPACE_V2;
  if (setting !== undefined) return setting === '1' || setting === 'true';
  return process.env.NODE_ENV === 'development';
}
