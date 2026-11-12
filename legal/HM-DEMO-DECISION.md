# Decision record: H&M products in the Sparta course demo
Date: 2026-11-12
Recorded from: the product owner (Ambarish Sengupta), who stated that the course professor, who works as a consultant for H&M, and a product owner from H&M confirmed and approved this use, and that they want to see the app with their products. This closes BRD OI-5 for the course demo. Who confirmed, on what date and by what means (email, meeting): **to be filled in by the product owner**, ideally with a copy of the email kept outside the repository.

## What is approved (as stated by the owner)
- Using the H&M Kaggle data (articles and product photographs) to show H&M products in a **private course demo** shown to H&M, the professor and the team.
- Training and using H&M-trained models in that demo (garment model version 2, pairing prior, unlock candidates) is also covered by the confirmation as the owner relays it; each is still switched on only when built and verified.
- The app does not go live unless H&M and their engineering partners approve.

## Conditions that stay in force
- The H&M files stay on team machines (the 32 GB folder is never copied). No H&M row, photograph, article id or customer id is committed to git, pushed to GitHub, or put in the open-source release. The demo reads photographs from the local folder at run time through a local-only image route that is OFF unless a local environment variable is set.
- The H&M photographs are served only on the demo machine. A private image route is NOT needed for this demo (owner's decision); before any wider release the photographs must move to private storage with access control, or be removed, and BRD BR-59 applies again in full.
- H&M data is never shown to vendors as rows; vendor figures stay aggregated, rounded and thresholded as built.
- BRD BR-59 is relaxed for this private demo build only. Release 1 and any wide release must re-check it.
- The Kaggle expectation that raw files are deleted when the course ends still applies.
- Known earlier finding (legal review item 20): a notebook output already pushed to GitHub shows five H&M purchase rows; it should be removed from the repository history or at least from the current tree.
