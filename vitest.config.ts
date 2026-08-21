import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      // Git worktrees under .claude/worktrees/ are full checkouts of other
      // branches, so vitest's default glob picks up their spec files too and
      // runs a different branch's suite against this branch's code. The
      // DB-backed specs also share one real database and clean up by device
      // id, so two copies racing delete each other's fixtures mid-run.
      '**/.claude/worktrees/**',
    ],
  },
});
