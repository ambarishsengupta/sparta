// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

// The only file that imports an icon library. Plan 4.2 proposes Phosphor
// (@phosphor-icons/react) as the single icon family; it is not approved yet, so
// these are Lucide icons, which shadcn/ui installs by default. If Phosphor is
// approved, swap the imports here (CoatHanger, Stack, Heart, Receipt, UserCircle)
// and nothing else changes.
import type { LucideIcon } from "lucide-react";
import {
  Check,
  CircleAlert,
  CircleUserRound,
  Heart,
  Hourglass,
  Layers,
  Moon,
  Pause,
  Play,
  Plus,
  ReceiptText,
  Shirt,
  Star,
  Sun,
} from "lucide-react";

import type { TabKey } from "@/lib/tabs";

export type Icon = LucideIcon;

export const TAB_ICONS: Record<TabKey, Icon> = {
  wardrobe: Shirt,
  outfits: Layers,
  wishlist: Heart,
  purchases: ReceiptText,
  me: CircleUserRound,
};

export const ErrorIcon: Icon = CircleAlert;
export const ComingSoonIcon: Icon = Hourglass;
export const AddIcon: Icon = Plus;
export const AddedIcon: Icon = Check;
export const RatingIcon: Icon = Star;
export const LightIcon: Icon = Sun;
export const DarkIcon: Icon = Moon;
export const PauseIcon: Icon = Pause;
export const PlayIcon: Icon = Play;
