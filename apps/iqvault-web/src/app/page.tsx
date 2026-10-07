"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useRole } from "@/shell/role-context";
import { conceptHref } from "@/shell/routes";

export default function LandingPage() {
  const { role } = useRole();
  const router = useRouter();
  useEffect(() => {
    router.replace(conceptHref(role.landing));
  }, [role.landing, router]);

  return (
    <p className="vip-callout">
      Opening {role.label} on {role.landing}.
    </p>
  );
}
