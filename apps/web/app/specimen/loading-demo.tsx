// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { messages } from "@/lib/i18n/messages";

/** Rest to loading to rest, with the result announced politely (plan 3.5). */
export function LoadingDemo() {
  const [loading, setLoading] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Button
        variant="secondary"
        loading={loading}
        data-testid="btn-loading-demo"
        onClick={() => {
          setAnnouncement("");
          setLoading(true);
          timer.current = setTimeout(() => {
            setLoading(false);
            setAnnouncement(messages.specimen.saved);
          }, 1200);
        }}
      >
        {messages.specimen.loadingDemo}
      </Button>
      <p role="status" aria-live="polite" className="text-ink-soft" data-testid="loading-status">
        {announcement}
      </p>
    </div>
  );
}
