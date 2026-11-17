# WO-0012 mutation evidence (apps/web: switches, Complete the look, Wardrobe unlock)

Method: the repository was copied (without node_modules, .next, .git) to a scratch folder OUTSIDE the repo, node_modules was symlinked, a throw-away git repo was made there (the git-ignore tests need one), and one change at a time was applied to the copy; then `npx vitest run apps/web` was run there and the copy reverted. A mutant is KILLED when at least one test fails. The unmutated copy passed first (230 tests; 231 after one test was added for M4). Nothing in the real repository was mutated. The mutation script is not committed (it lives in the session scratch folder).

| Id | File | Mutation | Result | Failing tests |
| --- | --- | --- | --- | --- |
| M1 | lib/engine-config.ts | pairing and embedding switches default to ON (`!== 'false'`) | KILLED | 10 |
| M2 | lib/engine-config.ts | the prior is fetched even when its switch is off | KILLED | 2 |
| M3 | lib/engine-config.ts | the prior file is cast, not validated with the engine parser | KILLED | 3 |
| M4 | lib/engine-config.ts | `res.ok` not checked (an HTTP error with a body is used) | SURVIVED the first run; KILLED (1) after I added the test "an HTTP error that still has a valid body" | 1 |
| M5 | lib/engine-config.ts | unlock list defaults to `hm` | KILLED | 4 |
| M6 | lib/engine-config.ts | a loaded prior is used although its switch is off | KILLED | 1 |
| M7 | lib/events.ts | events carry the fixed all-off string, not the real config | KILLED | 2 |
| M8 | lib/wishlist.ts | `wishlistAggregate` counts unlock entries | KILLED | 3 |
| M9 | lib/wishlist.ts | unlock entries are created with origin `user` | KILLED | 4 |
| M10 | lib/wishlist.ts | duplicate unlock entries are created | KILLED | 1 |
| M11 | lib/wishlist.ts | `wishlist_added` event not recorded | KILLED | 2 |
| M12 | lib/suggestions-view-model.ts | the early return that hides the anchor's own slot in `swapOptions` is removed | SURVIVED: an EQUIVALENT mutant. The filter below it (a choice must keep the anchor) already rejects every choice for the anchor's slot, so behaviour is identical. The early return is kept as an explicit short-cut. | 0 |
| M12b | lib/suggestions-view-model.ts | the anchor filter on swap choices is removed (early return kept) | KILLED | 1 |
| M13 | lib/suggestions-view-model.ts | a swap may push the anchor out of the outfit (the ANCHOR check in `applySwap` removed) | KILLED | 1 |
| M14 | lib/suggestions-view-model.ts | `anchor_not_valid` message drops the season | KILLED | 3 |
| M15 | lib/suggestions-view-model.ts | thin results are never flagged | KILLED | 1 |
| M16 | components/wardrobe/WardrobeList.tsx | Build outfits around this offered without the engine's `isOffered` check | KILLED | 3 |
| M17 | components/wardrobe/WardrobeList.tsx | the Build outfits link loses `prefetch={false}` | KILLED | 1 |
| M18 | apps/web/.gitignore | the pairing prior public file is no longer ignored | KILLED | 1 |
| M19 | components/outfits/OutfitCard.tsx | the anchor chip gets a Swap button | KILLED | 1 |
| M20 | lib/engine-config.ts | the unlock list request goes to a different URL | KILLED | 3 |
| M21 | components/outfits/UnlockPanel.tsx | Add to wishlist loses its accessible name | KILLED | 2 |
| M22 | lib/engine-config.ts | the request carries a body | KILLED | 2 |

Summary: 23 mutants; 22 killed (M4 only after I strengthened a test, because the first run showed it survived); 1 equivalent mutant (M12) survives by construction and is reported, not hidden. "Failing tests" are from the first run (parameterised cases count one each).
