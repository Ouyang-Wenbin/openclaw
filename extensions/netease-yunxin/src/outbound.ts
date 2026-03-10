import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { getNeteaseYunxinRuntime } from "./runtime.js";
import { sendMessageNeteaseYunxinWithConfig } from "./send.js";

const OUTBOUND_IMAGE_MAX_BYTES = 10 * 1024 * 1024; // 10MB

function extFromContentType(contentType: string | undefined): string {
  if (!contentType) return "jpg";
  const m = contentType.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("gif")) return "gif";
  if (m.includes("webp")) return "webp";
  return "jpg";
}

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
  sendMedia: async ({ cfg, to, text, mediaUrl, accountId, mediaLocalRoots }) => {
    if (!mediaUrl) {
      const result = await sendMessageNeteaseYunxinWithConfig({
        cfg,
        to,
        text: text ?? "",
        accountId,
      });
      if (!result.ok) throw new Error(result.error ?? "Send failed");
      return { channel: "netease-yunxin", messageId: result.messageId ?? "" };
    }
    const runtime = getNeteaseYunxinRuntime();
    let imagePath: string | undefined;
    let media: { buffer: Buffer; contentType?: string };
    try {
      try {
        media = await runtime.media.loadWebMedia(mediaUrl, {
          maxBytes: OUTBOUND_IMAGE_MAX_BYTES,
          localRoots: mediaLocalRoots?.length ? [...mediaLocalRoots] : undefined,
        });
      } catch (loadErr) {
        const msg = loadErr instanceof Error ? loadErr.message : String(loadErr);
        const isPathNotAllowed =
          msg.includes("not under an allowed directory") || msg.includes("path-not-allowed");
        const localPath = mediaUrl.startsWith("file://")
          ? mediaUrl.slice(mediaUrl.indexOf("file://") + 7)
          : mediaUrl;
        const normalized = path.normalize(localPath);
        const underTmp =
          normalized.startsWith(path.join(path.sep, "tmp") + path.sep) ||
          normalized === path.join(path.sep, "tmp");
        const underOsTmp = os.tmpdir() && normalized.startsWith(path.resolve(os.tmpdir()));
        if (isPathNotAllowed && path.isAbsolute(localPath) && (underTmp || underOsTmp)) {
          if (!fs.existsSync(localPath)) throw loadErr;
          const buf = fs.readFileSync(localPath);
          if (buf.length > OUTBOUND_IMAGE_MAX_BYTES) throw loadErr;
          const mime = runtime.media.detectMime?.({ buffer: buf, filePath: localPath });
          media = {
            buffer: buf,
            contentType: (typeof mime === "string" ? mime : undefined) ?? "image/jpeg",
          };
        } else {
          throw loadErr;
        }
      }
      const ext = extFromContentType(media.contentType);
      imagePath = path.join(
        os.tmpdir(),
        `openclaw-yunxin-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`,
      );
      fs.writeFileSync(imagePath, media.buffer);
      const meta =
        typeof runtime.media.getImageMetadata === "function"
          ? await runtime.media.getImageMetadata(media.buffer)
          : null;
      const result = await sendMessageNeteaseYunxinWithConfig({
        cfg,
        to,
        text: text ?? "",
        accountId,
        imagePath,
        imageName: path.basename(imagePath),
        imageWidth: meta?.width,
        imageHeight: meta?.height,
      });
      if (result.ok) {
        return { channel: "netease-yunxin", messageId: result.messageId ?? "" };
      }
      // Fallback: send as text with link when createImageMessage not available
    } finally {
      if (imagePath && fs.existsSync(imagePath)) {
        try {
          fs.unlinkSync(imagePath);
        } catch {
          // ignore
        }
      }
    }
    const isLocalPath =
      mediaUrl.startsWith("file://") ||
      (mediaUrl.startsWith("/") && !mediaUrl.startsWith("https://"));
    const attachmentLabel = isLocalPath ? "📎 [图片]" : `Attachment: ${mediaUrl}`;
    const messageWithMedia = [text ?? "", attachmentLabel].filter(Boolean).join("\n\n").trim();
    const result = await sendMessageNeteaseYunxinWithConfig({
      cfg,
      to,
      text: messageWithMedia || "📎 [图片]",
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
