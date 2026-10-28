import { redirect } from "next/navigation";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

// Minimal connect screen for Facebook-login mode (META_LOGIN_MODE=facebook).
export default async function FacebookConnectPage({
  searchParams,
}: {
  searchParams: Promise<{ result?: string }>;
}) {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");
  const { result } = await searchParams;

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Connect Instagram with Facebook login</h1>
      <p className="text-sm opacity-80">
        In the Meta Graph API Explorer, pick this app, add the permissions instagram_basic,
        instagram_manage_comments, instagram_manage_messages, pages_show_list,
        pages_read_engagement, pages_manage_metadata and business_management, click
        Generate Access Token, then paste the token here. It is exchanged on the
        server for the long-lived Page token and never shown again.
      </p>
      {result ? <p className="rounded border p-3 text-sm">{result}</p> : null}
      <form method="post" action="/api/facebook/connect" className="space-y-3">
        <label className="block text-sm">
          Instagram username
          <input name="username" defaultValue="ailowdown" className="mt-1 w-full rounded border p-2" />
        </label>
        <label className="block text-sm">
          Facebook Page ID (used if the Page is missing from the Pages list)
          <input name="pageId" defaultValue="1399642523233032" className="mt-1 w-full rounded border p-2" />
        </label>
        <label className="block text-sm">
          User access token
          <input
            name="userToken"
            type="password"
            autoComplete="off"
            className="mt-1 w-full rounded border p-2"
          />
        </label>
        <button type="submit" className="rounded bg-black px-4 py-2 text-white">
          Connect
        </button>
      </form>
    </div>
  );
}
