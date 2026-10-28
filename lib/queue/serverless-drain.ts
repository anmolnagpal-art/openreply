/**
 * Serverless worker mode.
 *
 * Runs the DM worker for a short window inside a Vercel function instead of
 * on an always-on server. Called right after a webhook (so DMs go out within
 * seconds) and by /api/cron/drain, which a free external timer hits every
 * minute to pick up retries, delayed jobs and comments the webhook missed.
 */
import os from "node:os";
import { getDMQueue } from "@/lib/queue/client";
import { createDMWorker } from "@/lib/queue/dm-worker";
import { recordWorkerHeartbeat } from "@/lib/ops/worker-health";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function drainQueue(budgetMs = 40_000): Promise<void> {
  const startedAt = Date.now();
  const queue = getDMQueue();
  const worker = createDMWorker();
  await recordWorkerHeartbeat({
    pid: process.pid,
    hostname: `serverless:${os.hostname()}`,
    startedAt: new Date(startedAt).toISOString(),
  }).catch(() => {});

  try {
    // Give the worker a moment to pick up jobs, then stop once nothing is
    // waiting or running. Delayed jobs are left for the next timer run.
    await sleep(2_000);
    while (Date.now() - startedAt < budgetMs) {
      const c = await queue.getJobCounts("waiting", "active", "prioritized");
      if ((c.waiting ?? 0) + (c.active ?? 0) + (c.prioritized ?? 0) === 0) break;
      await sleep(1_000);
    }
  } finally {
    await worker.close();
  }
}
