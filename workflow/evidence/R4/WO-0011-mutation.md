# WO-0011 mutation evidence (engine learned layer, Complete the look, Wardrobe unlock)

Method: the repository was copied (without node_modules and .git) to a scratch folder outside the repo; one change at a time was applied to the copy, then `npx vitest run packages/rules` was run there. A mutant is KILLED when at least one test fails. The unmutated copy passed first (351 tests). Nothing in the repository was mutated.

| Id | File | Mutation | Result | Failing tests |
| --- | --- | --- | --- | --- |
| P1 | pairing.ts | pair score ignores the colour table | KILLED | 2 |
| P2 | pairing.ts | outfit pairing divides by 3, not by the available pairs | KILLED | 2 |
| P3 | pairing.ts | version is not checked | KILLED | 2 |
| P4 | pairing.ts | x range 0..1 is not checked | KILLED | 2 |
| P5 | score.ts | prior on still uses weights_base | KILLED | 3 |
| P6 | score.ts | pairing part not added to the score parts | KILLED | 2 |
| P7 | suggest.ts | prior used without validation | KILLED | 1 |
| P8 | suggest.ts | the prior drops outfits with a low pairing score | KILLED | 1 |
| P9 | score.ts | prior-off score nudged by 1e-12 (byte identity) | KILLED | 9 |
| P10 | config.ts | engine_config always says w:base | KILLED | 2 |
| A1 | anchor.ts | outfits not holding the anchor are kept | KILLED | 7 |
| A2 | anchor.ts | belts are offered as anchors | KILLED | 3 |
| A3 | anchor.ts | anchor validity (R1, R2) not checked | KILLED | 8 |
| A4 | suggest.ts | only the first placement is tried | KILLED | 3 |
| A5 | suggest.ts | no untrimmed retry when the best eight hide every partner | KILLED | 1 |
| A6 | suggest.ts | reasons do not name the anchor | KILLED | 7 |
| A7 | anchor.ts | anchor is one candidate among others, not the only one | KILLED | 1 |
| U1 | unlock.ts | rule_fit threshold not applied | KILLED | 1 |
| U2 | unlock.ts | bound is 21 per slot | KILLED | 2 |
| U3 | unlock.ts | several colours of one sub-type are kept | KILLED | 3 |
| U4 | unlock.ts | four results | KILLED | 3 |
| U5 | unlock.ts | name tie-break reversed | KILLED | 1 |
| U6 | unlock.ts | pretend item is Winter-only | KILLED | 8 |
| U7 | unlock.ts | pairing prior ignored in the tie-break | KILLED | 1 |
| U8 | unlock.ts | 41 to 50 entry lists accepted | KILLED | 1 |
| U9 | unlock.ts | hm list used without the switch | KILLED | 2 |
| U10 | unlock.ts | add-back of one outfit kept in unlock | KILLED | 1 |
| U11 | unlock.ts | fewest outfits first | KILLED | 2 |
| U12 | unlock.ts | pretend item not checked against R1, R2 | KILLED | 1 |
| U13 | unlock-fallback.json | Sandals removed from the fallback list | KILLED | 1 |
| U14 | rules.json | bound in rules.json changed to 25 | KILLED | 2 |
| U15 | unlock.ts | layer-less outfits get a rule_fit bonus | KILLED | 1 |

32 mutants, 32 killed, 0 survived. One mutant (U10) survived the first test set; the test "the bound of 20 is exact" was added and it was then killed.
A7 is equivalent in output (the anchor outfit filter removes the extra outfits) and is killed only by the 1 s timing test.
