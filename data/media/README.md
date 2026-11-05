# Entry-page media

Licensed stock photos and video for the sign-in, onboarding, About and vendor sign-in pages (see `docs/IMPLEMENTATION-PLAN.md`, section 4.6).

- The files are **not committed**. The repository is public, and the Pexels licence does not allow redistribution on other platforms. `.gitignore` in this folder keeps everything except this README, `.gitignore` and `MANIFEST.json`.
- `MANIFEST.json` lists, for each file: source page, download URL, creator, licence, size, SHA-256 and the review result.
- To restore the files, download each `download_url` into `raw/` under its `file` name, then check the SHA-256.
- The site must self-host these files (no hotlinking) and show a credits page listing every creator.
- Never use these files to train or evaluate a model. The garment model is trained only on Fashion-MNIST (BRD BR-52).

Status (2026-11-05): 4 approved, 1 rejected (the original hero poster photo, which shows a university name and brand labels). The poster is now the first frame of the hero video, in `derived/` as JPEG (75 KB) and WebP (35 KB); the `ffmpeg` commands that rebuild it are in `MANIFEST.json`.
