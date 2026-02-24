import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    exclude: ["@arco-design/web-vue"]
  },
  build: {
    emptyOutDir: true
  },
  resolve: {
    // This project uses in-file template strings instead of SFC files.
    // Runtime compiler is required for `template: '...'` components.
    alias: {
      vue: "vue/dist/vue.esm-bundler.js"
    }
  },
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false
  },
  server: {
    host: "127.0.0.1",
    port: 5173
  },
  preview: {
    host: "127.0.0.1",
    port: 5173
  }
});
