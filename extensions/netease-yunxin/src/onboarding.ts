import crypto from "node:crypto";
import {
  DEFAULT_ACCOUNT_ID,
  resolveAccountIdForConfigure,
  type ChannelOnboardingAdapter,
  type OpenClawConfig,
  type WizardPrompter,
} from "openclaw/plugin-sdk";
import {
  listNeteaseYunxinAccountIds,
  resolveDefaultNeteaseYunxinAccountId,
  resolveNeteaseYunxinAccount,
} from "./accounts.js";
import { verifyNimCredentials } from "./sdk-client.js";

const channel = "netease-yunxin" as const;

/** Default appKey when not set (QuickStart / 初始化). */
const DEFAULT_APP_KEY = "638aae803525df4d733c7703e0c3323f";

function md5Hex(input: string): string {
  return crypto.createHash("md5").update(input, "utf8").digest("hex");
}

export const neteaseYunxinOnboardingAdapter: ChannelOnboardingAdapter = {
  channel,
  getStatus: async ({ cfg }) => {
    const configured = listNeteaseYunxinAccountIds(cfg).some((accountId) => {
      const account = resolveNeteaseYunxinAccount({ cfg, accountId });
      return account.configured;
    });
    return {
      channel,
      configured,
      statusLines: [`网易云信 IM: ${configured ? "已配置" : "需要 accountId 与 token"}`],
      selectionHint: configured ? "已配置" : "需要设置",
      quickstartScore: configured ? 2 : 1,
    };
  },
  configure: async ({ cfg, prompter, accountOverrides, shouldPromptAccountIds }) => {
    const defaultAccountId = resolveDefaultNeteaseYunxinAccountId(cfg);
    const accountId = await resolveAccountIdForConfigure({
      cfg,
      prompter,
      label: "网易云信 IM",
      accountOverride: accountOverrides["netease-yunxin"],
      shouldPromptAccountIds,
      listAccountIds: listNeteaseYunxinAccountIds,
      defaultAccountId,
    });

    const resolved = resolveNeteaseYunxinAccount({ cfg, accountId });
    const section = (cfg.channels?.["netease-yunxin"] ?? {}) as Record<string, unknown>;
    const appKey =
      resolved.appKey?.trim() || String(section.appKey ?? "").trim() || DEFAULT_APP_KEY;

    await prompter.note(
      [
        "请根据上方说明准备以下信息，并在下方依次输入：",
        "",
        "1) 请输入6位数工号",
        "2) 请输入乐办公密码",
        "",
        "appKey 已使用默认值，无需填写。",
        "Docs: https://docs.openclaw.ai/channels/netease-yunxin",
      ].join("\n"),
      "网易云信配置",
    );

    const accountIdInput = String(
      await prompter.text({
        message: "请输入6位数工号",
        initialValue: resolved.nimAccountId || undefined,
        validate: (v) => (String(v ?? "").trim() ? undefined : "必填"),
      }),
    ).trim();

    let token: string;
    for (;;) {
      const tokenInput = String(
        await prompter.text({
          message: "请输入乐办公密码",
          validate: (v) => (String(v ?? "").trim() ? undefined : "必填"),
        }),
      ).trim();
      token = md5Hex(tokenInput);
      const verify = await verifyNimCredentials({
        appKey,
        accid: accountIdInput,
        token,
      });
      if (verify.ok) {
        break;
      }
      const errText =
        typeof verify.error === "string"
          ? verify.error
          : JSON.stringify(verify.error ?? "未知错误");
      await prompter.note(`校验失败：${errText}\n请检查工号与密码后重新输入。`, "登录校验");
    }

    const channels = { ...(cfg.channels ?? {}) };
    const nextSection: Record<string, unknown> = {
      ...section,
      enabled: true,
      appKey,
    };

    if (accountId === DEFAULT_ACCOUNT_ID) {
      nextSection.accountId = accountIdInput;
      nextSection.token = token;
    } else {
      const accounts = { ...(section.accounts as Record<string, unknown> | undefined) };
      const existing = (accounts[accountId] ?? {}) as Record<string, unknown>;
      accounts[accountId] = {
        ...existing,
        enabled: true,
        appKey,
        accountId: accountIdInput,
        token,
      };
      nextSection.accounts = accounts;
    }

    const next: OpenClawConfig = {
      ...cfg,
      channels: { ...channels, "netease-yunxin": nextSection },
    };

    return { cfg: next, accountId };
  },
};
