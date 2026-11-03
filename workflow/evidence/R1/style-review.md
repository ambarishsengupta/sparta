# AI style review of the R1 review pack (Opus Style consultant, 2026-11-04)
This is an AI style review. It is NOT the human style specialist's (Arpan Shah) G9 sign-off.

Sample: 70 suggestions hand-judged across the five wardrobes, all occasions, warm and cool seasons (sample leans towards suspect rows). Result: 45 of 70 acceptable = 64%, below the FDD 14.4 bar of about 80%. By wardrobe: Starter student 10/18, Office regular 12/18, Minimalist neutrals 12/14, Colourful casual 11/20. A script over all 249 rows flags 55 rule-detectable problems (at most 77.9% acceptable). The thin wardrobe had no suggestions (its 28 'missing' messages were correct).

Top 5 systematic problems and suggested changes
1. Colour clashes that R3 allows (13 rows): add `max_non_neutral_families: 2` for Work, Formal and Date, or a `clashing_family_pairs` list (Red/Purple, Red/Yellow, Pink/Yellow, Pink/Purple, Green/Red) with a penalty of about 0.3.
2. Activewear outside Sport (10 rows) and non-sport layers in Sport (2): give Date and Travel their own entries without Sports T-shirt, Sports shorts and Track pants; Sport layer limited to Track jacket, Hoodie, Jacket.
3. Season (4 shorts in cool seasons, 12 winter outfits with no layer): Winter excludes Shorts, Sports shorts, Sandals (Sport exempt); Autumn excludes Sandals; require a layer when one is owned.
4. Formality mismatch (8 suits or business wear in Travel, 6 oxfords with tees or polos, 2 Formal without a jacket, no tie ever): remove Suit and Tuxedo from Casual and Travel bottoms; forbid Formal shoes with T-shirt, Polo or Hoodie; enforce the Formal blazer when owned. (Tie as a Formal accessory would be an FDD change: not adopted.)
5. Work too loose (7 rows) and reason text overstating: Work layer without Hoodie, Track jacket or windcheater-style jackets; no Printed or Graphic tops; at most one bold item. Reasons: r1 'Meets the {occasion} dress rule', r2 'Nothing is out of season for {season}'; 'Every piece is tagged for {occasion}' only when occasion_fit is 1.
