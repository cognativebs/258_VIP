"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";

function ForwardEbayCode() {
  const params = useSearchParams();

  useEffect(() => {
    const code = params.get("code");
    if (!code) {
      window.location.replace(
        `/ebay?oauth_error=${encodeURIComponent("No code on the callback. Click Connect and Allow once.")}`,
      );
      return;
    }
    window.location.replace(
      `http://127.0.0.1:8787/api/ebay/sell/auth/callback?code=${encodeURIComponent(code)}`,
    );
  }, [params]);

  return <p className="muted">Finishing eBay connection…</p>;
}

export default function EbayOAuthCallbackPage() {
  return (
    <div className="shell">
      <Suspense fallback={<p className="muted">Finishing eBay connection…</p>}>
        <ForwardEbayCode />
      </Suspense>
    </div>
  );
}
