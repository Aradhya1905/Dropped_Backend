import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * Run spec FILES one at a time.
     *
     * Most of this suite drives the real app against one shared Postgres.
     * Vitest's default is a worker per file, and at 18 files that is 18
     * connection pools against a single remote database: fixtures in
     * `beforeAll` start timing out, and a `POST /drops` in setup can come back
     * something other than 201. Nothing is wrong with the code when that
     * happens, which is the worst kind of failure to have in a suite.
     *
     * The specs are only isolated from each other by device id anyway — they
     * genuinely share one database — so file-level parallelism was never
     * buying real isolation, just contention. Sequential costs ~2 minutes.
     */
    fileParallelism: false,
    /**
     * Fixture setup does several round trips to a remote database (create a
     * few drops, reveal one, save one). Vitest's 10 s default is a local-SQLite
     * number; this one is sized for a network.
     */
    hookTimeout: 60_000,
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
