// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

// All UI copy lives in messages/en.json (LLD 9.4, NFR-5). This typed import is a
// stand-in until next-intl (LLD section 2) is wired in later in M1; the JSON file
// is the same one next-intl will read, so pages will not need their copy moved.
import en from "./messages/en.json";

export const messages = en;
export type Messages = typeof en;
