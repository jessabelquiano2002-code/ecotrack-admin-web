"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The Agency Report now lives in Reports & Analytics → "Generate Report".
// This route is kept so old bookmarks and links still work.
export default function AgencyReportRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/analytics#report");
  }, [router]);

  return null;
}
