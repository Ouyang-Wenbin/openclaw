import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { neteaseYunxinPlugin } from "./src/channel.js";
import { setNeteaseYunxinRuntime } from "./src/runtime.js";

const plugin = {
  id: "netease-yunxin",
  name: "NetEase Yunxin IM",
  description: "NetEase Yunxin IM (NIM) channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setNeteaseYunxinRuntime(api.runtime);
    api.registerChannel({ plugin: neteaseYunxinPlugin });
  },
};

export default plugin;
export { neteaseYunxinPlugin } from "./src/channel.js";
export { sendMessageNeteaseYunxinWithConfig } from "./src/send.js";
