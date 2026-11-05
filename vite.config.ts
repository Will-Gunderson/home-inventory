import { defineConfig } from "vite";
import { existsSync, readFileSync } from "node:fs";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// With MOCK_AI=1 in .dev.vars nothing calls Workers AI, so skip its remote connection
// (which needs a Cloudflare login) and run fully offline.
const mockAi = existsSync(".dev.vars") && /^MOCK_AI=1\s*$/m.test(readFileSync(".dev.vars", "utf8"));

export default defineConfig({
  plugins: [react(), cloudflare({ remoteBindings: !mockAi })],
  optimizeDeps: { exclude: ["@imgly/background-removal"] },
});
