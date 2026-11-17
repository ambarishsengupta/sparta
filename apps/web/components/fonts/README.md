# Fonts

Location note (WO-0093): the work order names `apps/web/public/fonts/`, but a folder in `public/` fails the existing `proxy.test.ts` (it requires every entry of `public/` to be excluded by name in the proxy matcher, and `proxy.ts` is outside this work order's scope) and its files would be redirected to sign-in for signed-out visitors. The files therefore live here and `app/globals.css` references them by relative URL, so Next bundles them as `/_next/static/media/*.woff2` (self-hosted, never sent through the proxy).

| File | Family | Weight | Subset |
| --- | --- | --- | --- |
| `ibm-plex-mono-latin-400-normal.woff2` | IBM Plex Mono | 400 (Regular) | latin |
| `ibm-plex-mono-latin-500-normal.woff2` | IBM Plex Mono | 500 (Medium) | latin |

- Name: IBM Plex Mono. Copyright 2017 IBM Corp.
- Version: the files come from the npm package `@fontsource/ibm-plex-mono` 5.3.0 (the packaged IBM Plex Mono release).
- Licence: SIL Open Font License 1.1. The full text is in `OFL.txt` next to the files (copied unchanged from the package's LICENSE file). The fonts are used and redistributed unmodified and are not sold on their own.
- Source: https://www.npmjs.com/package/@fontsource/ibm-plex-mono (upstream project: https://github.com/IBM/plex).
- How they were obtained (WO-0093): `npm pack @fontsource/ibm-plex-mono` in a scratch directory outside the repository, unpacked there, and only the two latin woff2 files above plus the licence text were copied here. The package is NOT a dependency of this repository.
- SHA-256: 08949f728dc52d528e69b1667d15c89a5686a4ee9a296ff90983985f99c380f7 (400), 01d285447409c8a588692162439a038b8cbd7871309ee20267b0d2d91c6e8e22 (500).
- Fallback stack when the files cannot load: Helvetica, Arial (system fonts, nothing is shipped for them). No other font is used or allowed (a source test checks every `font-family`).
