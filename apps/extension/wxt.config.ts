import { defineConfig } from "wxt";
import { GATEWAY_ORIGIN } from "./lib/gateway-config";

export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "LingoBridge",
    description: "Translate selected text without leaving the page.",
    host_permissions: [`${GATEWAY_ORIGIN}/*`],
    permissions: ["storage"],
    action: {
      default_title: "Open LingoBridge",
    },
    icons: {
      16: "icon/16.png",
      32: "icon/32.png",
      48: "icon/48.png",
      128: "icon/128.png",
    },
  },
});
