// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

import Link from "next/link";

import {
  EmptyState,
  ErrorState,
  SettingsList,
  TabFrame,
  TabSkeleton,
  type TabState,
} from "@/components/shared/tab-states";
import { Button } from "@/components/ui/button";
import { messages } from "@/lib/i18n/messages";
import { TABS, type TabKey } from "@/lib/tabs";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const PREVIEW_STATES = new Set<TabState>(["empty", "loading", "error"]);

/**
 * There is no data layer yet, so each tab renders its empty state (or, for Me,
 * its settings list). `?state=loading` and `?state=error` render the other two
 * states in place, so they can be reviewed and tested before the data layer exists.
 */
export async function readState(searchParams: SearchParams, tab: TabKey): Promise<TabState> {
  const raw = (await searchParams).state;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value && PREVIEW_STATES.has(value as TabState)) {
    if (tab === "me" && value === "empty") return "ready";
    return value as TabState;
  }
  return tab === "me" ? "ready" : "empty";
}

export function TabPage({ tab, state }: { tab: TabKey; state: TabState }) {
  return (
    <TabFrame tab={tab}>
      {state === "loading" ? (
        <TabSkeleton tab={tab} />
      ) : state === "error" ? (
        <ErrorState
          tab={tab}
          retry={
            <Button asChild>
              <Link href={TABS[tab].href}>{messages.states.retry}</Link>
            </Button>
          }
        />
      ) : tab === "me" ? (
        <SettingsList />
      ) : (
        <EmptyState tab={tab} />
      )}
    </TabFrame>
  );
}

export function tabMetadata(tab: TabKey) {
  return { title: messages.tabs[tab].title };
}
