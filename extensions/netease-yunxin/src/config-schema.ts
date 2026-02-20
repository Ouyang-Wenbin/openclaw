import { DmPolicySchema, requireOpenAllowFrom } from "openclaw/plugin-sdk";
import { z } from "zod";

const NeteaseYunxinAccountSchemaBase = z
  .object({
    appKey: z.string().optional(),
    accountId: z.string().optional(),
    token: z.string().optional(),
    enabled: z.boolean().optional(),
    allowFrom: z.array(z.string()).optional(),
    dmPolicy: DmPolicySchema.optional().default("pairing"),
  })
  .strict();

const NeteaseYunxinAccountSchema = NeteaseYunxinAccountSchemaBase.superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message:
      'channels.netease-yunxin.dmPolicy="open" requires channels.netease-yunxin.allowFrom to include "*"',
  });
});

export const NeteaseYunxinConfigSchema = NeteaseYunxinAccountSchemaBase.extend({
  accounts: z.record(z.string(), NeteaseYunxinAccountSchema.optional()).optional(),
}).superRefine((value, ctx) => {
  requireOpenAllowFrom({
    policy: value.dmPolicy,
    allowFrom: value.allowFrom,
    ctx,
    path: ["allowFrom"],
    message:
      'channels.netease-yunxin.dmPolicy="open" requires channels.netease-yunxin.allowFrom to include "*"',
  });
});
