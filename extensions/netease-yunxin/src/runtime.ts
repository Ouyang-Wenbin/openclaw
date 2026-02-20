import type { PluginRuntime } from "openclaw/plugin-sdk";

type NeteaseYunxinRuntime = PluginRuntime;

let runtime: NeteaseYunxinRuntime | null = null;

export function setNeteaseYunxinRuntime(r: NeteaseYunxinRuntime): void {
  runtime = r;
}

export function getNeteaseYunxinRuntime(): NeteaseYunxinRuntime {
  if (!runtime) {
    throw new Error("netease-yunxin: runtime not set (plugin not registered)");
  }
  return runtime;
}
