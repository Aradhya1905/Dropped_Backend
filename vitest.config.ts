import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Git worktrees live under .claude/worktrees/ and are full checkouts, so
      // without this every spec runs twice — once here and once from whatever
      // branch a worktree is parked on. That is not merely noisy: the
      // DB-backed specs share one real database and clean up by device id, so
      // two copies of the same file running concurrently delete each other's
      // fixtures mid-run.
      '**/.claude/worktrees/**',
    ],
  },
});
