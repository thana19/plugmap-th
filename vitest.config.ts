import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  test: {
    projects: [
      {
        // unit + integration ที่รันใน workerd (D1 local ของ miniflare)
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              // TEAM_PIN สำหรับ test เท่านั้น — inject ผ่าน miniflare ไม่อ่าน .dev.vars
              bindings: { TEAM_PIN: "test-pin-1234" },
            },
          }),
        ],
        test: {
          name: "workers",
          include: ["worker/test/**/*.test.ts"],
          exclude: ["worker/test/**/*.node.test.ts"],
        },
      },
      {
        // test ที่ต้องใช้ filesystem (logo manifest) รันใน Node
        test: {
          name: "node",
          environment: "node",
          include: ["worker/test/**/*.node.test.ts"],
        },
      },
    ],
  },
});
