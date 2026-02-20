import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { getNeteaseYunxinRuntime } from "./runtime.js";
import { sendMessageNeteaseYunxinWithConfig } from "./send.js";

export const neteaseYunxinOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  chunker: (text, limit) => getNeteaseYunxinRuntime().channel.text.chunkMarkdownText(text, limit),
  chunkerMode: "markdown",
  textChunkLimit: 4000,
  sendText: async ({ cfg, to, text, accountId }) => {
    const result = await sendMessageNeteaseYunxinWithConfig({
      cfg,
      to,
      text,
      accountId,
    });
    if (!result.ok) {
      throw new Error(result.error ?? "Send failed");
    }
    return {
      channel: "netease-yunxin",
      messageId: result.messageId ?? "",
    };
  },
  sendMedia: async ({ cfg, to, text, mediaUrl, accountId }) => {
    const messageWithMedia = mediaUrl
      ? `${text ?? ""}\n\nAttachment: ${mediaUrl}`.trim()
      : (text ?? "");
    const result = await sendMessageNeteaseYunxinWithConfig({
      cfg,
      to,
      text: messageWithMedia || "(media)",
      accountId,
    });
    if (!result.ok) {
      throw new Error(result.error ?? "Send failed");
    }
    return {
      channel: "netease-yunxin",
      messageId: result.messageId ?? "",
    };
  },
};
