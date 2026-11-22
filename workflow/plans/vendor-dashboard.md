# Vendor dashboard and retail insights: plan (UI-first demo phase)

Owner's ask, 2026-11-22: more functionality and more insights for vendors; all sorts of graphs (pie, bar, line and others); a vendor dashboard with a holistic view of the current status across all stores, so that one glance shows which specific items are performing well and which need stocking, among which age groups. Simulated data only, in the no-login demo (`isNoLoginDemo()`), UI only, no backend, no tests until the owner says.

## 0. Ground rules for every worker
- Everything lives behind `isNoLoginDemo()` (`apps/web/lib/demo-mode.ts`). The account-backed vendor screens stay as they are.
- One data source for all vendor retail screens: `apps/web/lib/demo-vendor-retail.ts` (section 2). No screen invents its own numbers.
- One chart kit for all graphs: `apps/web/components/ui/charts/` (section 1). No outside chart library, no new npm package, no outside script.
- The look: black and white, IBM Plex Mono, uppercase 12px labels, hairlines, square corners (no border-radius), no shadows, one accent colour. Colours only through the CSS variables in `app/globals.css`, never hex values in components.
- Every product shows its real H&M photo through `components/ui/ProductPhoto.tsx`.
- Every new screen carries the line "Simulated demo data: no real users or sales." in the muted small style under its heading.
- The vendor is "Northline Apparel (demo vendor)", as in `lib/demo-vendor.ts`.

## 1. Chart kit (`components/ui/charts/`): worker 1
Hand-built SVG components, all responsive (they fill their container's width and keep a set aspect ratio), all with a title, a legend where there is more than one series, a tooltip on hover or tap showing the exact value, and a visually hidden table of the values.
- **Palette** (CSS variables added to `globals.css`, light and dark):
  - `--chart-1` the accent;
  - `--chart-2` the ink;
  - `--chart-3` a mid grey;
  - `--chart-4` a light grey;
  - `--chart-5` the accent hatched (an SVG pattern);
  - `--chart-6` the ink hatched.
  - At most 6 series in one chart. The rest are folded into "Other" in `--chart-4`.
- **Components**, each in its own file and exported from `index.ts`:
  1. `KpiTile`: label, big value, change versus the previous period (up or down arrow, percent), optional sparkline.
  2. `Sparkline`: a tiny line, no axes.
  3. `LineChart`: multi-series, x = weeks, y axis with 4 to 5 gridlines, optional dashed forecast segment, hover crosshair.
  4. `AreaChart`: stacked areas, the same axes as LineChart.
  5. `BarChart`: vertical or horizontal; single, grouped or stacked; value labels optional.
  6. `PieChart`: pie or donut (a `donut` prop), labels with percent, centre total for the donut.
  7. `Heatmap`: rows × columns, cells shaded on a 5-step ramp from `--chart-4` to `--chart-1`, the value in each cell, row and column headers.
  8. `Gauge`: a half-circle 0–100 with a needle and a target mark (for sell-through and stock health).
  9. `Legend`: swatches with labels, used by the others.
  10. `StatusBadge`: "Healthy", "Watch", "Restock now" and "Overstock" (accent filled, outlined, ink filled and hatched).

## 2. Retail demo data (`lib/demo-vendor-retail.ts`): worker 1
Deterministic: a small seeded generator (fixed seed), no `Math.random`, the same numbers on every load.
- **Stores (9):**
  - Mumbai Linking Road, Delhi Select Citywalk, Bengaluru Indiranagar, Hyderabad Inorbit, Chennai Phoenix, Pune Koregaon Park, Kolkata Quest, Ahmedabad Alpha One;
  - plus "Online".
  - Each has a city, a region (North, South, East or West), a size (S, M or L) and an opening year.
- **Products (24):** chosen at run time from the H&M demo articles (`NEXT_PUBLIC_HM_DEMO_ARTICLES` via `lib/pilot-config.ts`), spread over Tops, Bottoms, Outerwear, Footwear and Accessories. Each has the article id (for its photo), name, category, sub-type, colour, price in INR (₹599 to ₹4,999), cost (55% of price) and a launch week.
- **Age groups:** 18–24, 25–34, 35–44 and 45+. **Genders:** Men, Women, and Other or not said. The share of Women is small; the catalogue is menswear.
- **Weekly facts, last 12 weeks plus a 4-week forecast,** per product × store × age group:
  - units sold, revenue, wishlist adds and returns;
  - stock on hand at week end, units on order, and the week's in-store visits per store.
  - Shape it believably: a seasonal lift on outerwear, two products as clear best sellers, two as slow movers, three heading for a stockout within 2 weeks at named stores, one overstocked, and the 25–34 group largest overall with 18–24 leading in streetwear-like items.
- **Derived helpers (exported functions, used by every screen):**
  - `sellThrough(product, store?)`;
  - `weeksOfCover(product, store?)`, stock divided by the average weekly units of the last 4 weeks;
  - `stockStatus`: Restock now if cover is under 2 weeks and demand is rising; Watch if under 4; Overstock if over 12; otherwise Healthy;
  - `topSellers(n, filters)`, `needsRestock(filters)` (sorted by stockout date) and `ageMix(product)`;
  - `storeHealth(store)` (counts of each status), `trend(metric, filters)` and `forecast(product, store)`.
  - Filters are `{ weeks: 4 | 12, store?, region?, ageGroup?, category? }`.
- **Restock suggestion per product × store:** the quantity to reach 6 weeks of cover, rounded up to a pack of 6, with the cost.

## 3. The holistic dashboard (`/vendor` in the demo): worker 2
One screen that answers "what is selling, what needs stock, for whom, where", top to bottom.
1. **Global filter bar** (sticky): period (Last 4 weeks / Last 12 weeks), region, store, age group, category. Every block below follows it.
2. **KPI row, 6 tiles, each with a sparkline and change versus the previous period:** Revenue, Units sold, Sell-through %, Average weeks of cover, Items to restock now (count, in the accent colour), Wishlist adds.
3. **"Needs stock now" strip:** the 6 most urgent restock items as photo cards, each showing:
   - the status badge and the stores it is short at;
   - weeks of cover and the stockout date;
   - the age group buying it most;
   - a "Restock" button that opens the restock builder (section 5) with that item pre-filled.
4. **"Best performers" strip:** the top 6 items by sell-through as photo cards, showing units, sell-through gauge, the top age group and the trend sparkline.
5. **Item × age group heatmap:** rows are the top 12 items with a thumbnail, columns the 4 age groups, cells units sold. The cell for each item's leading age group is outlined. Clicking a row opens the product page (section 4).
6. **Charts row 1:** a revenue LineChart, actual 12 weeks plus a dashed 4-week forecast, one line per region; and a category-mix PieChart (donut).
7. **Charts row 2:** an age-group BarChart, grouped by category (units); and a gender split PieChart.
8. **Store status board:** a table, one row per store, showing:
   - status badges count (Healthy / Watch / Restock now / Overstock);
   - revenue with a sparkline, sell-through and weeks of cover;
   - the store's best item (thumbnail) and its most urgent item (thumbnail).
   Sorted by restock count. Clicking a row opens the store page (section 4).
9. **Charts row 3:** a sell-through BarChart by store (horizontal, with a target line at 65%); and an inventory-vs-demand AreaChart (stock on hand vs 4-week demand, total).
10. The existing dashboard blocks (from the demo vendor data) move under a heading "Pilot audience insights" at the bottom, unchanged. The Top cities and Planning advice teasers stay above them.

## 4. Products and stores (worker 3)
- **`/vendor/products`:** a sortable table of the 24 products with these columns:
  - thumbnail, name, category, price;
  - units (period), sell-through, weeks of cover, status badge;
  - top age group and a 12-week sparkline.
  It has the same filter bar as the dashboard, a search box and an "Export CSV" button (a client-side download of the rows shown).
- **`/vendor/products/[id]`:** the large photo and the facts. Then:
  - KPI tiles (units, revenue, sell-through, cover, returns %);
  - a weekly units LineChart with forecast;
  - units by age group (PieChart donut) and by gender (BarChart);
  - stock by store (horizontal BarChart, with each store's cover shown);
  - a store × age group Heatmap;
  - a "Restock" button (section 5).
- **`/vendor/stores`:** a card grid, one card per store, showing:
  - city, region and size;
  - status counts and a revenue sparkline;
  - sell-through Gauge and top item thumbnail.
- **`/vendor/stores/[id]`:** KPI tiles; a revenue LineChart; a category PieChart; an age-group BarChart; the store's products table, sorted by urgency; and visits vs units (a LineChart with two series).

## 5. Vendor actions and the rest (worker 4)
- **Restock builder (`/vendor/restock`):**
  - a list of suggested lines (product thumbnail × store × suggested quantity × cost), pre-ticked for "Restock now" items;
  - quantities are editable in steps of 6, with a running total of units and cost;
  - "Create order" adds an order to a local list (state kept in `localStorage` under `sparta.demo.vendor.orders.v1`) and shows "Order NL-0001 created (demo only: nothing was sent)".
  - Opened from a Restock button, it pre-selects that product.
- **Orders (`/vendor/orders`):** the list of demo orders with number, date, lines, units, cost and a status that moves Draft → Placed → In transit → Received when the vendor clicks "Advance (demo)".
- **Stock transfers (`/vendor/transfers`):** suggested moves from overstocked to short stores, for the same product: from, to, quantity, and the weeks of cover before and after at each end. "Approve" marks one as approved (local only).
- **Alerts (`/vendor/alerts`):**
  - a feed of the current alerts: stockout within 2 weeks, overstock, sudden demand rise among an age group, slow mover;
  - each alert has a severity, time, product thumbnail, store and a link to act;
  - settings for the thresholds (cover weeks for Restock now and for Overstock) kept in `localStorage`; changing them changes the statuses everywhere.
- **Export:** "Export CSV" on the dashboard store board, the products table, the restock list and the orders list.
- **Locations and Planning get charts:**
  - on `/vendor/locations`, an age-group PieChart for the selected city and a users-by-city horizontal BarChart;
  - on `/vendor/planning`, a BarChart of recommended unit change by region and a PieChart of actions.
- **Navigation:** the vendor links become Dashboard, Products, Stores, Restock, Orders, Transfers, Alerts, Locations, Planning, Gaps, Reports and Account. On a phone they collapse into a "Menu" disclosure. The Alerts link shows the open alert count.

## 6. Order of work and who touches what
| Worker | Files it owns | Depends on |
|---|---|---|
| 1 | `components/ui/charts/**`, `lib/demo-vendor-retail.ts`, the chart palette in `app/globals.css` | nothing |
| 2 | `app/vendor/page.tsx`, `components/vendor/dashboard/**` (new), `components/vendor/Dashboard.tsx` (only to move it under the new heading), `components/vendor/insights/Teasers.tsx`, `globals.css` (dashboard rules only) | 1 |
| 3 | `app/vendor/products/**`, `app/vendor/stores/**`, `components/vendor/products/**`, `components/vendor/stores/**`, `globals.css` (their rules only) | 1 |
| 4 | `app/vendor/restock/**`, `app/vendor/orders/**`, `app/vendor/transfers/**`, `app/vendor/alerts/**`, `components/vendor/actions/**`, `lib/demo-vendor-actions.ts`, `components/vendor/insights/LocationsView.tsx`, `components/vendor/insights/PlanningView.tsx`, `components/Nav.tsx`, `lib/demo-csv.ts`, `globals.css` (their rules only) | 1, 2 and 3 (the Restock buttons link to its route) |

The workers run one after another in one checkout (branch `ui/po-preview`), so no two write at the same time. Each one commits its own files only and checks only that `npx tsc --noEmit -p .` in `apps/web` prints nothing. No tests, no Playwright, no gate, no browser check until the owner says.
