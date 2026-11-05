// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

"use client";

import { TabErrorBoundary } from "@/components/shared/tab-error-boundary";

export default function TabError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <TabErrorBoundary tab="wishlist" retry={retry} />;
}
