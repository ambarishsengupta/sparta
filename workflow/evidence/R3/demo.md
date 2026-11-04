# R3 demo transcript (CC5), WO-0022 (redo)

Date: 2026-11-04 (machine date, so the northern-hemisphere season is Autumn).

## Correction of the previous demo.md (WO-0021)
The previous version of this file said: 'The WO allows "load the demo wardrobe or add 6 items by hand"'. **No work order says that.** WO-0021 does not contain that sentence, and the previous run used the demo loader instead of adding items by hand. That claim is removed. The previous file also had no screenshots. This version replaces it.

## What was done, plainly
- App: the production build (`npm run build -w apps/web`, Next.js 16.4.5), started with `npx next start apps/web -p 3123` and driven in the built-in browser pane (desktop pane, 800x600 screenshots, light colour scheme). The server was stopped afterwards. Browser storage was cleared first, so the app started empty.
- The six items were added **by hand through the item form** (`/items/new`): category, sub-type and colour set in the form, the name left to the automatic naming, occasions Casual and Work ticked, Save item pressed. The demo loader was NOT used anywhere in this run.
- How the browser was driven (not hidden): the form selects and the colour field were set with the browser tool's form-fill call (it sets the value and fires the change events). For item 1 the Casual and Work boxes were ticked with pointer clicks; for items 2 to 6 they were ticked with `checkbox.click()` run in the page. Save item was a pointer click on the real button each time. In step 8 Archive, and in step 10 Restore, were `button.click()` calls run in the page on the real controls, and several occasion buttons were pressed the same way. The keyboard checks in step 6 used real key presses (Enter, Tab, Escape) sent by the browser tool, but each sequence started by calling `.focus()` on the starting button from the page, not by tabbing in from the top of the page.
- The browser tool reported the pane as "hidden" during the run; screenshots and DOM reads still worked. Some screenshots lag a moment behind the DOM (one early screenshot showed a checkbox before its state updated); where that mattered, the state below was read from the page, not from the picture.

Screenshot files are in this folder and are referenced below. Page-text and storage readings are from the live page.

## 1. Add six items by hand (item form)
- Items added, in order (name is the automatic name, colour family derived on save): White Shirt (#F4F4F4, White), Blue Shirt (#9DB9E0, Blue), Khaki Chinos (#C8B38A, Khaki), Grey Trousers (#36454F, Grey), Black Formal shoes (#1A1A1A, Black), White Sneakers (#F4F4F4, White). All tagged Casual and Work, no season.
- Saw: the form shows "Colour family: White" and the name "White Shirt" before saving (`01-item-form-auto-name.jpg`); after the sixth save the Wardrobe lists "6 of 6 items" (`02-wardrobe-six-items.jpg`, the first five visible).
- Storage: 6 items; the event log holds 6 `item_added` events, every one with origin `manual` and six different timestamps (03:51:49.709, 03:52:01.332, 03:52:12.384, 03:52:16.891, 03:52:21.282, 03:52:25.991 UTC), no item name or id.
- Nav: on `/` the Wardrobe link had `aria-current="page"` and Outfits none; on `/outfits` the reverse (read from the DOM).

## 2. Casual: three outfits with reasons
- Did: Outfits, Casual. Saw (page text) three cards, each 71% match: Outfit 1 White Shirt / Khaki Chinos / Black Formal shoes; Outfit 2 Blue Shirt / Grey Trousers / White Sneakers; Outfit 3 White Shirt / Khaki Chinos / White Sneakers. On each card the one-line reason is "Meets the Casual dress rule; Nothing is out of season for Autumn" and a "Why this outfit?" disclosure follows (`03-casual-outfit-1.jpg`).
- Opened the disclosure on Outfit 1: "Every piece is tagged for Casual", "White, khaki and black are neutral and go with anything", "At most one pattern, so nothing clashes" (`04-casual-why-disclosure-open.jpg`).

## 3. Work: three outfits
- Did: clicked Work. Saw the same three item sets as for Casual, with "Meets the Work dress rule; Nothing is out of season for Autumn", 71% each (`05-work-outfit-1.jpg`; the disclosure on Outfit 1 was still open from step 2). The wardrobe is small, so Casual and Work give the same combinations.

## 4. Swap (and the "Same as outfit N" note)
- Did: focused "Swap Khaki Chinos" on Work Outfit 1, pressed Enter. Saw focus move to the sheet heading "Swap bottom" with one choice, Grey Trousers (`06-swap-sheet-bottom-focus-on-heading.jpg`). Pressed Escape: sheet closed, focus back on "Swap Khaki Chinos" (read from `document.activeElement`).
- Did: opened it again, Tab Tab to Cancel, Enter: sheet closed, focus back on "Swap Khaki Chinos".
- Did: focused "Swap Black Formal shoes", Enter (`07-swap-sheet-footwear.jpg`, one choice, White Sneakers), Tab, Enter. Saw: note "Swapped the footwear. The outfit still follows the rules."; focus on the new "Swap White Sneakers" button (focus ring visible); Outfit 1 now holds the same pieces as Outfit 3, so it shows "Same as outfit 3" and "Swapped by you, so it is not scored again." with no match bar and only the one-line reasons (`08-after-swap-same-as-outfit-3-focus-returned.jpg`).
- Event logged: `suggestion_swapped`, slot footwear, Work, Autumn, rule_ids `["R1","R2"]` (the card as it is after the swap, not its pre-swap rule ids).

## 5. Accept (keyboard) and Reject
- Did: focused "Accept outfit 2", pressed Enter. Saw: heading "Outfit 2 (saved)" with a focus ring and `document.activeElement` = the heading `h2#outfit-title-2`; the Accept button reads "Saved" and is disabled (`09-accepted-focus-on-heading.jpg`). Storage: one outfit (Work, item-2, item-4, item-6, score 0.7075, five reasons); event `suggestion_accepted` with rule ids R1, R2, OCC, R3, R4.
- Did: clicked "Reject outfit 3". Saw "Outfit 3 removed."; cards left: Outfit 1 and Outfit 2 (saved); the "Same as outfit 3" note on Outfit 1 went away because no other card matches any more. Event `suggestion_rejected`.

## 6. Manual keyboard check (summary)
Enter on Swap: sheet opens, focus on its heading. Escape: closes, focus on the opener. Cancel (Tab Tab Enter): closes, focus on the opener. Pick (Tab Enter): applies, focus on the Swap button of the same slot. Enter on Accept: saved, focus on the card heading. All read from `document.activeElement`. Starting points were set with `.focus()` (see above). The occasion buttons are real `<button>`s with `aria-pressed` (source test); in this run occasions were chosen by pointer or `.click()`, so picking an occasion with the keyboard was NOT exercised live.

## 7. Nothing leaves the browser
- Did: counted the page's resource entries (18), then picked Casual, Party, opened a swap, chose the first choice and picked Work, then counted again: 18 and 18.
- The pane's request log also held old entries from an earlier run on port 3199, so it is not a clean log. Filtered to port 3123 it shows no request to `/items/item-*` (item pages are not prefetched now that item links use `prefetch={false}`), no `/favicon.ico` and no console errors (preload warnings only). `GET /favicon.ico` with curl is still 404; it is no longer requested because the page declares `<link rel="icon" href="/icon.svg"/>` (served 200). A browser that ignores the link could still ask for it; other browsers were not tested.
- The other requests are Next.js route prefetches for `/`, `/outfits` and `/items/new` from the nav and the Add item link (no wardrobe data in them).

## 8. Thin wardrobe
- Did: on the Wardrobe screen archived four items through the real Archive control (reason sold): White Sneakers, Grey Trousers, Khaki Chinos, Blue Shirt; two stayed active (White Shirt, Black Formal shoes). Then Outfits, Work.
- Saw: "You need a bottom for this occasion." and the link "Go to your wardrobe to add items" (`10-thin-wardrobe-message.jpg`).

## 9. Reload and persistence
- Did: full page load of `/`. Saw "2 of 6 items" with Black Formal shoes and White Shirt (`11-after-reload-wardrobe-persisted.jpg`). Storage: 6 items, 1 saved outfit; events: item_added 6, suggestion_swapped 1, suggestion_accepted 1, suggestion_rejected 1. A full load of `/outfits` and Work gave the same "You need a bottom" message.

## 10. Phone width (375 x 812)
- Did: resized to 375x812, loaded `/outfits`, Work: "You need a bottom for this occasion." (`12-phone-375-thin-wardrobe-after-reload.jpg`); `scrollWidth` 375, so no horizontal scroll. Then restored the four archived items with the real Restore control (Wardrobe, Archived filter) and picked Formal: two outfits (not three; the wardrobe is small), Outfit 1 White Shirt / Grey Trousers / Black Formal shoes, 51% (`13-phone-375-formal-outfit-1.jpg`); `scrollWidth` 375. The occasion buttons wrap onto two rows. The viewport was reset to desktop afterwards.

## Not done / limits
- Three outfits were checked for Casual and Work at desktop width only; Formal at 375 gave two.
- The Southern hemisphere toggle and dark mode were not exercised in this run.
- No screenshot of the form with the occasions ticked (a lagging capture showed the wrong checkbox state, so it was not kept), and none of Work outfits 2 and 3 (their text is in the notes above).
- Favicon: the evidence is the link in the HTML, no favicon request or console error in the pane, and the curl results; not a check in several browsers.

## Observations
1. After a swap the outfit has no score and only the R1 and R2 reasons: the engine's public API cannot score an arbitrary outfit (a LATER engine item, per WO-0022).
2. Casual and Work gave the same item sets, and Work offered White Sneakers; that is the engine's rules over six items.
