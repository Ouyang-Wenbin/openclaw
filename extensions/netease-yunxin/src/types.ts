/** Config section under channels.netease-yunxin (and per-account in accounts[id]). SDK-only. */
export type NeteaseYunxinAccountConfig = {
  /** NetEase app key (from NIM console). */
  appKey?: string;
  /** NIM account id (accid), used for SDK login. */
  accountId?: string;
  /** Login token for SDK (required). See 获取静态 Token in NIM docs. */
  token?: string;
  enabled?: boolean;
  allowFrom?: string[];
  dmPolicy?: "pairing" | "allowlist" | "open" | "disabled";
  /** Group @mention: also treat message as mentioning us when text contains @<name>. Use when client shows display name (e.g. 欧阳文斌) instead of accid in @. */
  mentionDisplayNames?: string[];
};

export type NeteaseYunxinConfig = NeteaseYunxinAccountConfig & {
  accounts?: Record<string, NeteaseYunxinAccountConfig | undefined>;
};

export type ResolvedNeteaseYunxinAccount = {
  accountId: string;
  enabled: boolean;
  configured: boolean;
  appKey: string;
  nimAccountId: string;
  token: string;
  config: NeteaseYunxinAccountConfig;
};

export type NeteaseYunxinSendResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
};
