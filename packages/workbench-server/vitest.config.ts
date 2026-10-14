import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    // A TZ change only reaches the real time zone in a child process; worker threads keep the zone
    // their isolate started with. Time-zone tests need the real process zone.
    poolMatchGlobs: [["**/__tests__/*time-zone*.test.ts", "forks"]],
  },
});
