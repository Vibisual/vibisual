import { resolveCodexPermission } from '@vibisual/shared';

export const LOCAL_TRANSPORT_NETWORK_REQUIRED = 'Local transport blocked — network access permission is required (local-transport-network-required).';

export interface CodexLocalTransportInput {
  platform: NodeJS.Platform;
  required?: boolean;
  permissionMode?: string;
  networkAccess?: boolean;
  configuredNetworkAccess?: readonly boolean[];
  configUnreadable?: boolean;
}

/**
 * Native Windows sandbox /health passed with network_access omitted (CLI 0.162.0-alpha.17.2).
 * macOS Seatbelt / Linux bwrap default networking is off: enable only this requested invocation.
 * https://learn.chatgpt.com/docs/agent-approvals-security#network-access
 */
export function codexLocalTransportNetwork(input: CodexLocalTransportInput): boolean | undefined {
  if (!input.required) return input.networkAccess;
  if (input.networkAccess === false || input.configuredNetworkAccess?.includes(false)) {
    throw new Error(LOCAL_TRANSPORT_NETWORK_REQUIRED);
  }
  const { sandbox } = resolveCodexPermission(input.permissionMode);
  if (sandbox === 'danger-full-access') return input.networkAccess;
  if (sandbox !== 'workspace-write' || input.configUnreadable) throw new Error(LOCAL_TRANSPORT_NETWORK_REQUIRED);
  if (input.networkAccess === true || input.configuredNetworkAccess?.includes(true)) return input.networkAccess;
  return input.platform === 'darwin' || input.platform === 'linux' ? true : input.networkAccess;
}
