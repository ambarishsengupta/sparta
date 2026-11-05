// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

"use client";

import { ErrorState, TabFrame } from "@/components/shared/tab-states";
import { Button } from "@/components/ui/button";
import { messages } from "@/lib/i18n/messages";
import type { TabKey } from "@/lib/tabs";

/** Shared body of each tab's error.tsx: the inline error with a working Retry. */
export function TabErrorBoundary({ tab, retry }: { tab: TabKey; retry: () => void }) {
  return (
    <TabFrame tab={tab}>
      <ErrorState
        tab={tab}
        retry={<Button onClick={() => retry()}>{messages.states.retry}</Button>}
      />
    </TabFrame>
  );
}
