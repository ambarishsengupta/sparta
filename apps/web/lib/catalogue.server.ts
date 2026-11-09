// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

// Server-only (imported only from server components): reads the local manifest.
import { readFile } from "node:fs/promises";
import path from "node:path";

import { type CatalogueItem, SAMPLE } from "@/lib/catalogue";

export async function loadCatalogue(): Promise<{
  items: CatalogueItem[];
  source: "photos" | "sample";
}> {
  try {
    const file = path.join(process.cwd(), "public", "catalogue", "manifest.json");
    const items = JSON.parse(await readFile(file, "utf8")) as CatalogueItem[];
    if (Array.isArray(items) && items.length > 0) return { items, source: "photos" };
  } catch {
    // No local manifest: fall through to the sample.
  }
  return { items: SAMPLE, source: "sample" };
}
