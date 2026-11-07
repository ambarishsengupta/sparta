// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

import Link from "next/link";
import { Suspense } from "react";

import { CatalogueGrid } from "@/components/shared/catalogue-grid";
import { TabFrame, TabSkeleton } from "@/components/shared/tab-states";
import { loadCatalogue } from "@/lib/catalogue.server";

export const metadata = { title: "Popular items" };

async function Grid() {
  const { items, source } = await loadCatalogue();
  return (
    <>
      <p className="mb-6 max-w-[65ch] text-sm text-ink-soft">
        {source === "photos"
          ? "Photos from the H&M Kaggle dataset, shown locally for academic demonstration only. Prices and ratings are demo values."
          : "Sample items with placeholder tiles. Prices and ratings are demo values."}
      </p>
      <CatalogueGrid items={items} />
    </>
  );
}

export default function Page() {
  return (
    <TabFrame tab="wardrobe">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm">
        <Link
          href="/wardrobe"
          className="font-semibold text-accent-text underline underline-offset-4"
        >
          Wardrobe
        </Link>
        <span aria-hidden="true"> / </span>
        <span>Popular items</span>
      </nav>
      <Suspense fallback={<TabSkeleton tab="wardrobe" />}>
        <Grid />
      </Suspense>
    </TabFrame>
  );
}
