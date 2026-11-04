# R3 demo transcript (CC5), WO-0021

Date: 2026-11-04 (machine date, so the north-hemisphere season is Autumn).
App: the production build (`npm run build -w apps/web`, Next.js 16.4.5), started with `next start apps/web -p 3123` and driven in the built-in browser pane (desktop width, dark colour scheme). Screenshots cannot be saved, so each step says what was looked at. Browser storage was cleared first, so the app started empty. The server was stopped afterwards.

Wardrobe used: the "Office regular" demo wardrobe from the Load demo button (24 items; the R1 fixture, read-only). The WO allows "load the demo wardrobe or add 6 items by hand"; the demo loader was used. Adding items by hand through the item form was not repeated here (WO-0020 owns that screen and its tests).

## 1. Empty state
- Did: opened http://localhost:3123/outfits with empty storage.
- Saw (page text): "Outfits / Everything is worked out in this browser. Nothing is sent anywhere. / Occasion: Casual Work Formal Party Sport Date Travel / Southern hemisphere / Season now: Autumn (northern hemisphere) / You have no active items yet. Load a demo wardrobe to try suggestions, or add your own. [Load demo wardrobe] [Add an item]".
- Visual: seven occasion buttons in a row, unchecked hemisphere box, a bordered notice with the two buttons. Nothing wrong.

## 2. Load the demo wardrobe
- Did: clicked Load demo wardrobe.
- Saw: "Added 24 items from the Office regular demo wardrobe. / Pick an occasion to see outfits from your wardrobe." Local event log got 24 `item_added` events (origin `demo`, no occasion).

## 3. Casual (mouse)
- Did: clicked Casual. The button turned filled (aria-pressed true).
- Saw three outfit cards. Outfit 1: Navy polo (Top), Dark indigo jeans (Bottom), Charcoal merino sweater (Layer), White leather sneakers (Footwear); reasons "Meets the Casual dress rule", "Nothing is out of season for Autumn", "Every piece is tagged for Casual", "Navy, grey and white are neutral and go with anything", "At most one pattern, so nothing clashes", "Layer works for cool weather"; "85% match" with a bar. Outfit 2: White cotton shirt, Beige chinos, Navy blazer, Black oxfords, Black leather belt, 78% match. Outfit 3: Light blue oxford shirt, Olive chinos, Grey herringbone blazer, Brown brogues, Brown leather belt, 72% match. Each card ends with Accept and Reject; each piece has a Swap button.
- Visual: item chips show a coloured dot, the name and the slot in muted text; reasons have a tick; the match bar is a thin filled track.

## 4. Work (keyboard)
- Did: focused the Work button, pressed Enter (no mouse).
- Saw: Work pressed, three new outfits. Outfit 1: White cotton shirt, Charcoal wool trousers, Navy blazer, Black oxfords, Black leather belt, 96% match, seven reasons including "Belt and shoes share a colour family". Outfit 2: Light blue oxford shirt, Navy trousers, Charcoal merino sweater, Brown brogues, Brown leather belt, 90%. Outfit 3: Pale pink shirt, Beige chinos, Grey herringbone blazer, White leather sneakers, 83%.

## 5. Swap
- Did: clicked "Swap Charcoal wool trousers" on Outfit 1.
- Saw: a sheet under the card, focus moved to its heading "Swap bottom": Navy trousers (Trousers), Olive chinos (Chinos), Beige chinos (Chinos), then Cancel. Same sub-type first, then the others. Dark indigo jeans were not offered (not allowed for Work).
- Did: chose Navy trousers.
- Saw: sheet closed; note "Swapped the bottom. The outfit still follows the rules."; Outfit 1 now shows Navy trousers as Bottom, only the two re-checked reasons ("Meets the Work dress rule", "Nothing is out of season for Autumn"), and "Swapped by you, so it is not scored again." instead of the match bar. Log: one `suggestion_swapped`, slot bottom, Work, Autumn.

## 6. Accept (keyboard)
- Did: focused "Accept outfit 2", pressed Enter.
- Saw: note "Outfit 2 saved."; heading "Outfit 2 (saved)"; the button reads "Saved" and is disabled; Reject and Swap are gone/disabled on that card. Storage: one outfit under `outfits` (Work, five item ids, score 0.898, seven reasons). Log: `suggestion_accepted`.
- Problem noticed: after Enter on Accept the button becomes disabled, so keyboard focus drops to the page body (see report).

## 7. Reject
- Did: clicked "Reject outfit 3".
- Saw: note "Outfit 3 removed."; two cards left. Log: `suggestion_rejected`. Event counts then: item_added 24, suggestion_swapped 1, suggestion_accepted 1, suggestion_rejected 1. Every event holds engine_config `gm1;emb0;pair0;ul:fb;w:base`, occasion, season, rule ids and slot; no item name or id.

## 8. Nothing leaves the browser
- Did: counted the browser's resource entries, then picked Casual, picked Party, opened a swap, chose the first swap choice and rejected an outfit, then counted again.
- Saw: 18 before, 18 after; no new request of any kind.
- Note: elsewhere the browser pane's network list shows Next.js route prefetches (GET /?_rsc, /items/item-NN?_rsc) fired by the Wardrobe list's links; they are not part of the suggestion path (see report).

## 9. Hemisphere toggle
- Did: ticked Southern hemisphere.
- Saw: "Season now: Spring (southern hemisphere)", the Party outfits' reason became "Nothing is out of season for Spring". Storage `sparta.settings.v1` = {"version":1,"hemisphere":"south"}.

## 10. Thin wardrobe
- Did: on the Wardrobe screen archived 22 of the 24 items through the real Archive control (kept White cotton shirt and Black oxfords; status line "2 of 24 items"), clicked Outfits in the navigation, picked Work.
- Saw: "You need a bottom for this occasion." and a link "Go to your wardrobe to add items" (to /). No cards.
- Visual: a bordered notice; the sentence in bold, link in the link colour.

## 11. Reload and persistence
- Did: reloaded /outfits, then picked Work again.
- Saw: Southern hemisphere still ticked, "Season now: Spring (southern hemisphere)"; storage still held 24 items (2 active: White cotton shirt, Black oxfords; 22 archived), 1 saved outfit, 29 events (24 item_added + 2 swapped + 1 accepted + 2 rejected); Work again said "You need a bottom for this occasion."

## 12. Phone width
- Did: reset storage, reloaded at 375 x 812, loaded the demo wardrobe, picked Formal.
- Saw: no horizontal scroll (page width 375); the occasion buttons wrap onto two rows; cards stack with the Swap buttons at the right of each chip; three Formal cards, Outfit 1 white shirt, charcoal trousers, navy blazer, black oxfords, black belt, 96%.

## Problems noticed
1. Browser console shows two 404s: /favicon.ico (no favicon is served; only /icon.svg exists). From the scaffold, not WO-0021.
2. Focus is lost after keyboard Accept (the button turns disabled).
3. After a swap the outfit shows no score and only the two hard-rule reasons, because the engine's public API cannot score an arbitrary outfit.
4. A reason list is six or seven short lines per card, not one line (the engine returns one sentence per rule; FR-52 says "one-line reason").
