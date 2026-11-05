# Sparta web app

The consumer PWA, vendor portal and admin console (LLD section 3). This first slice is the design tokens and the app shell from milestone M1 in `docs/IMPLEMENTATION-PLAN.md`. It has no backend, auth or data yet.

## Run it

Node 22.18 or later (CI uses 24).

```bash
npm ci
npm run dev            # http://localhost:3000, redirects to /wardrobe
```

## Checks (all run in CI, `.github/workflows/ci.yml`)

| Command                  | What it checks                                                                                                                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`           | ESLint (Next.js core web vitals and TypeScript rules)                                                                                                                                                                                    |
| `npm run typecheck`      | `tsc --noEmit`, strict                                                                                                                                                                                                                   |
| `npm run format:check`   | Prettier                                                                                                                                                                                                                                 |
| `npm run check:contrast` | WCAG contrast of every token pair in plan 4.4, read from `app/globals.css`; exits 1 on any failure                                                                                                                                       |
| `npm run build`          | `next build`                                                                                                                                                                                                                             |
| `npm run test:e2e`       | Playwright against `next start`: axe (tags wcag2a, wcag2aa, wcag21aa, wcag22aa) on every tab and state plus `/specimen`, the shell, and the six button states, at 375 x 812 and 1440 x 900 in light and dark. Run `npm run build` first. |

## Where things are

| Path                        | Contents                                                                                                                                  |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `app/globals.css`           | Colour tokens for light and dark (plan 4.3), shadcn/ui variables mapped onto them, type scale, radius, motion tokens, reduced-motion rule |
| `app/layout.tsx`            | Fonts through `next/font`: Bricolage Grotesque, Instrument Sans, Geist Mono, served from this app                                         |
| `app/(consumer)/`           | Shell layout (skip link, tab bar or rail) and the five tabs, each with `loading.tsx` and `error.tsx`                                      |
| `components/ui/button.tsx`  | shadcn/ui Button restyled to the tokens, with the six states in plan 3.5                                                                  |
| `components/shared/`        | Tab navigation, page header, empty, loading and error states, and `icons.ts` (the only icon import)                                       |
| `lib/i18n/messages/en.json` | All UI copy                                                                                                                               |
| `app/specimen/`             | Button states and colour tokens rendered for review and for axe; not linked from the app and marked `noindex`                             |

## Previewing states

Until the data layer exists, each tab shows its empty state (Me shows its settings list). Add `?state=loading` or `?state=error` to any tab URL to see the other two, for example `/wardrobe?state=loading`.

## Notes for later M1 work

- **Icons:** Phosphor (`@phosphor-icons/react`) is PROPOSED in plan 4.2 and not yet approved. Until then the tabs use Lucide, which shadcn/ui installs by default. Swapping is a change to `components/shared/icons.ts` only.
- **Motion:** `motion` is PROPOSED and not installed. The tab pill, icon tilt, hanger swing, skeleton shimmer and button feedback are CSS transitions and keyframes on `transform` and `opacity`. Every one is instant under `prefers-reduced-motion: reduce`.
- **Copy:** pages read `lib/i18n/messages/en.json` through a typed import. next-intl (LLD section 2) can read the same file when it is wired in.
- **Theme:** the app follows the system setting. `data-theme="light"` or `"dark"` on `<html>` overrides it; the contrast script checks that the two dark blocks in `globals.css` stay identical.
- **Font licences:** all three fonts are SIL Open Font License 1.1 (plan 4.5). They still need recording beside LOI-3 and LOI-10.
