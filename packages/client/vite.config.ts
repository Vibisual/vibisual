import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
// 4800 = @vibisual/shared DEFAULT_PORT 와 동기화 (vite config 는 config 로드 시점에
// shared dist 가 없을 수 있어 런타임 import 대신 리터럴 유지 — 변경 시 양쪽 같이 수정).
const SERVER_PORT = Number(process.env['VIBISUAL_SERVER_PORT']) || 4800;
const CLIENT_PORT = Number(process.env['VIBISUAL_CLIENT_PORT']) || 5173;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: CLIENT_PORT,
    strictPort: true,
    proxy: {
      '/ws': {
        target: `ws://localhost:${SERVER_PORT}`,
        ws: true,
      },
      '/api': {
        target: `http://localhost:${SERVER_PORT}`,
      },
      '/health': {
        target: `http://localhost:${SERVER_PORT}`,
      },
      '/iframe-proxy': {
        target: `http://localhost:${SERVER_PORT}`,
      },
    },
  },
});
