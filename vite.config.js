import { defineConfig } from 'vite';

const developmentConnectPolicy = "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:*";

export default defineConfig(({ command }) => ({
  base: './',
  plugins: [{
    name: 'production-content-security-policy',
    transformIndexHtml(html) {
      if (command !== 'build') return html;
      return html.replace(developmentConnectPolicy, "connect-src 'self'");
    },
  }],
  build: {
    chunkSizeWarningLimit: 700,
    sourcemap: false,
  },
}));
