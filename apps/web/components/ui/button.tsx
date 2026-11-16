// Sparta, a privacy-first menswear wardrobe app.
// Copyright (C) 2026 the Sparta team. Licensed under the GNU GPL v3.0; see LICENSE.

// shadcn/ui Button, restyled to the Sparta tokens. Six states (plan 3.5):
//   rest      token fill or outline
//   hover     3 px ink offset shadow, up 1 px (pointer devices only: Tailwind's
//             hover variant is wrapped in @media (hover: hover))
//   focus     2 px focus ring, 2 px offset, :focus-visible only
//   pressed   down 1 px, shadow removed, 75 ms
//   disabled  45% opacity, no shadow, not-allowed cursor (`disabled` attribute)
//   loading   label kept, small progress bar inside, aria-busy and aria-disabled.
//             aria-disabled rather than `disabled` keeps keyboard focus on the
//             button while it works. The caller announces the result politely.
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 overflow-hidden",
    "rounded-full border-[1.5px] font-sans font-semibold whitespace-nowrap select-none",
    "transition-transform duration-150 ease-snap",
    // hover (skipped while disabled or loading)
    "not-disabled:not-aria-disabled:hover:-translate-y-px not-disabled:not-aria-disabled:hover:shadow-offset",
    // pressed
    "not-disabled:not-aria-disabled:active:translate-y-px not-disabled:not-aria-disabled:active:shadow-none not-disabled:not-aria-disabled:active:duration-75",
    // focus: the global :focus-visible rule draws the ring; restated so a
    // component-level reset can never remove it
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
    // disabled
    "disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none",
    "aria-disabled:cursor-not-allowed",
    // aria-disabled without aria-busy is a plain disabled button; loading keeps full opacity.
    "aria-disabled:not-aria-busy:opacity-45",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  ],
  {
    variants: {
      variant: {
        // Brand and primary action. Light-mode tangerine is under 3:1 on the
        // canvas, so the ink edge marks the boundary (plan 4.3).
        primary: "border-flash-edge bg-tangerine text-on-tangerine",
        secondary: "border-ink bg-surface text-ink",
        ghost:
          "border-transparent bg-transparent text-ink not-disabled:not-aria-disabled:hover:bg-tangerine-tint not-disabled:not-aria-disabled:hover:shadow-none",
      },
      size: {
        md: "min-h-11 px-5 py-2.5 text-base",
        sm: "min-h-9 px-4 py-1.5 text-sm [&_svg:not([class*='size-'])]:size-4",
        icon: "size-11",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

// loading is not supported with asChild: a child link would still navigate and
// there is nowhere to put the progress bar.
type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> &
  (
    | {
        asChild?: false;
        /** Keeps the label, shows a progress bar and blocks clicks. */
        loading?: boolean;
      }
    | { asChild: true; loading?: never }
  );

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  type,
  onClick,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";

  const loadingProps = loading
    ? {
        "aria-busy": true,
        "aria-disabled": true,
        // A submit button must not submit twice while it is busy.
        type: "button" as const,
        // Only wrap a handler that exists: a server component passes none, and
        // a new function there could not be serialised to the client.
        onClick: onClick
          ? (event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault()
          : undefined,
      }
    : { type: asChild ? type : (type ?? "button"), onClick };

  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? "primary"}
      data-loading={loading || undefined}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
      {...loadingProps}
    >
      {asChild ? (
        children
      ) : (
        <>
          {children}
          {loading ? (
            <span
              aria-hidden="true"
              data-slot="button-progress"
              className="absolute inset-x-5 bottom-1.5 h-0.5 overflow-hidden rounded-full bg-current/25"
            >
              <span className="block h-full w-1/3 animate-button-progress rounded-full bg-current motion-reduce:w-full motion-reduce:animate-none motion-reduce:opacity-60" />
            </span>
          ) : null}
        </>
      )}
    </Comp>
  );
}

export { Button, buttonVariants };
