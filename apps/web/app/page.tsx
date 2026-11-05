// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

import { redirect } from "next/navigation";

// Wardrobe is the primary outcome (BRD section 6), so it is home.
// Auth and consent gating (proxy.ts, LLD 9.1) arrive with the rest of M1.
export default function Home() {
  redirect("/wardrobe");
}
