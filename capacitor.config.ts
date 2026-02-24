import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.rainyun.appweb",
  appName: "雨云 App",
  webDir: "dist",
  bundledWebRuntime: false,
  android: {
    allowMixedContent: true
  },
  plugins: {
    StatusBar: {
      overlaysWebView: false,
      style: "DARK",
      backgroundColor: "#f4f8ff"
    },
    Keyboard: {
      resize: "body",
      style: "DARK"
    }
  }
};

export default config;
