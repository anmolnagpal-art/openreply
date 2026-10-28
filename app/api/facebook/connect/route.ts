import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getBaseUrl, getMetaGraphApiVersion, requireEnv } from "@/lib/env";
import { canConnectInstagramAccount } from "@/lib/instagram-accounts";
import { subscribeInstagramAccountToWebhooks, isFacebookLoginMode } from "@/lib/meta/client";
import { encryptToken } from "@/lib/meta/oauth";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

type PageRow = {
  id: string;
  name: string;
  access_token?: string;
  instagram_business_account?: { id: string; username?: string; name?: string };
};

async function graphGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${getMetaGraphApiVersion()}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data?.error?.message ?? `Graph request failed (${res.status})`);
  }
  return data as T;
}

function back(reason: string) {
  return NextResponse.redirect(
    `${getBaseUrl()}/settings/facebook?result=${encodeURIComponent(reason.slice(0, 200))}`,
    303
  );
}

// Facebook-login connection: takes a short-lived user token (e.g. from the
// Graph API Explorer for this app), swaps it for a long-lived one, and stores
// the never-expiring token of the Page linked to the Instagram account.
export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.redirect(`${getBaseUrl()}/login`, 303);
  if (!canManageWorkspace(context.role)) return back("Only workspace owners and admins can connect accounts");
  if (!isFacebookLoginMode()) return back("Set META_LOGIN_MODE=facebook first");

  const form = await request.formData();
  const userToken = String(form.get("userToken") ?? "").trim();
  const wantedUsername = String(form.get("username") ?? "").trim().replace(/^@/, "").toLowerCase();
  if (!userToken) return back("Paste a token first");

  try {
    const longLived = await graphGet<{ access_token: string }>("oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: requireEnv("FACEBOOK_APP_ID"),
      client_secret: requireEnv("FACEBOOK_APP_SECRET"),
      fb_exchange_token: userToken,
    });

    const pages = await graphGet<{ data: PageRow[] }>("me/accounts", {
      fields: "id,name,access_token,instagram_business_account{id,username,name}",
      limit: "100",
      access_token: longLived.access_token,
    });

    const withIg = pages.data.filter((p) => p.instagram_business_account && p.access_token);
    const page =
      withIg.find((p) => p.instagram_business_account?.username?.toLowerCase() === wantedUsername) ??
      (wantedUsername ? undefined : withIg[0]);
    if (!page || !page.instagram_business_account || !page.access_token) {
      return back(
        withIg.length
          ? `No Page linked to @${wantedUsername}. Found: ${withIg.map((p) => "@" + p.instagram_business_account?.username).join(", ")}`
          : "No Facebook Page with a linked Instagram account was found for this token"
      );
    }

    const ig = page.instagram_business_account;
    const instagramId = ig.id;
    const connection = await canConnectInstagramAccount({ workspaceId: context.workspaceId, instagramId });
    if (!connection.allowed) return back("This Instagram account is connected to another workspace");

    let webhookSubscribed = false;
    try {
      const sub = await subscribeInstagramAccountToWebhooks(instagramId, page.access_token);
      webhookSubscribed = Boolean(sub.success);
    } catch (e) {
      console.warn("[Facebook Connect] Page webhook subscription failed:", e);
    }

    const data = {
      username: ig.username ?? page.name,
      name: ig.name ?? page.name,
      accessToken: encryptToken(page.access_token),
      // Page tokens made from a long-lived user token do not expire.
      tokenExpiresAt: null,
      webhookSubscribed,
    };
    const existing = await prisma.instagramAccount.findUnique({ where: { instagramId } });
    if (existing) {
      await prisma.instagramAccount.update({ where: { id: existing.id }, data });
    } else {
      await prisma.instagramAccount.create({
        data: { ...data, workspaceId: context.workspaceId, instagramId, provider: "META" },
      });
    }

    return back(`Connected @${data.username}${webhookSubscribed ? "" : " (Page webhook subscription failed, see logs)"}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    await prisma.operationalEvent
      .create({
        data: {
          source: "SYSTEM",
          level: "ERROR",
          workspaceId: context.workspaceId,
          message: "Facebook-login connection failed",
          payload: { reason: message },
        },
      })
      .catch(() => {});
    return back(`Failed: ${message}`);
  }
}
