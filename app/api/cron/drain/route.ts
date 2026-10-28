import { NextRequest, NextResponse } from "next/server";
import { drainQueue } from "@/lib/queue/serverless-drain";
import { reconcileComments } from "@/lib/polling/comment-reconciler";
import { attachPendingNextReels } from "@/lib/automation/attach-next-reel";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Hit every minute by a free external timer (e.g. cron-job.org) with
// header "Authorization: Bearer <CRON_SECRET>". Does the always-on worker's
// job in short bursts: the polling safety net, then sends whatever is queued.
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const pollEvery = Number(process.env.COMMENT_POLL_INTERVAL_MS ?? 5 * 60_000);
  const minute = Math.floor(Date.now() / 60_000);
  const pollThisRun = minute % Math.max(1, Math.round(pollEvery / 60_000)) === 0;
  if (pollThisRun) {
    try {
      await attachPendingNextReels();
      await reconcileComments();
    } catch (error) {
      console.error("[Drain] Reconcile failed:", error instanceof Error ? error.message : error);
    }
  }

  await drainQueue(45_000);
  return NextResponse.json({ success: true, polled: pollThisRun });
}
