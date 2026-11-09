// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

"use client";

// Items picked from "popular items" in this visit, shared by the grid (tick on the
// tile) and the tab bar (count badge on Wardrobe). There is no wardrobe store until
// M2, so picks live in sessionStorage: they survive tab changes and reloads, and
// disappear when the browser tab closes. Nothing leaves the device.
import { useSyncExternalStore } from "react";

const KEY = "sparta-picks";
const EMPTY: readonly string[] = [];

let picks: readonly string[] | null = null;
const listeners = new Set<() => void>();

function load(): readonly string[] {
  if (picks) return picks;
  try {
    const raw = sessionStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    picks = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    picks = [];
  }
  return picks;
}

function save(next: readonly string[]) {
  picks = next;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage blocked: picks last until reload.
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Adds or removes an item; returns true when it is now picked. */
export function togglePick(id: string): boolean {
  const current = load();
  const on = !current.includes(id);
  save(on ? [...current, id] : current.filter((x) => x !== id));
  return on;
}

export function usePicks(): readonly string[] {
  return useSyncExternalStore(subscribe, load, () => EMPTY);
}
