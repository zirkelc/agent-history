import { defineConfig } from 'vitest/config'

// The plugin's own tests run in the sandbox of `claude plugin test`, which has no real processes. These tests run the git code against real repositories.
export default defineConfig({
  // The plugin's tsconfig extends a file that Claude Code writes only when it loads the plugin, so it is often missing. The transform needs no tsconfig.
  oxc: { tsconfig: false } as never,
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
