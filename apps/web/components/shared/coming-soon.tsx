// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

import { ComingSoonIcon } from "@/components/shared/icons";
import { messages } from "@/lib/i18n/messages";

/** A not-yet-available action: a dashed label, not a control, so it is never mistaken for a broken button. */
export function ComingSoon({ label }: { label: string }) {
  return (
    <p className="inline-flex min-h-11 items-center gap-2 rounded-full border-[1.5px] border-dashed border-control-border px-4 text-sm text-ink-soft">
      <ComingSoonIcon aria-hidden="true" className="size-4 shrink-0" strokeWidth={2} />
      <span>
        <span className="font-semibold text-ink">{label}</span>, {messages.preview.comingSoon}
      </span>
    </p>
  );
}
