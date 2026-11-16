// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

import { readState, TabPage, tabMetadata } from "@/components/shared/tab-page";

export const metadata = tabMetadata("purchases");

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <TabPage tab="purchases" state={await readState(searchParams, "purchases")} />;
}
