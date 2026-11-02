# Astrofoto

**CCD-piltidest värvifotoni** – from CCD frames to a colour image.

Astrofoto is a browser app for students in grades 8–9. With it they turn monochrome CCD frames from a telescope (FITS files) into a colour image of a deep-sky object, and learn why each step is needed along the way. It was made for an after-school astronomy project.

The app is in Estonian, with an English version.

**Use it:** <https://astrotuvi.github.io/astrofoto/>

## What the student does

1. **Files:** load FITS files, a folder or a zip. The app reads the headers, sorts the frames by type and filter, and checks that they fit together.
2. **Calibration:** trim the overscan, make master bias, dark and flat frames, and calibrate the light frames.
3. **Alignment and stacking:** align the frames by clicking stars, check the automatic alignment, and stack each filter.
4. **Colour:** choose which filter goes to which colour channel, set the black and white points and the stretch, and export the image.
5. **Report:** collect figures, plots and measurements, then download a `.docx`, copy sections into Google Docs or Word, or print.

Each step has a short explanation ("Miks?"), tasks with hints, and measuring tools: pixel values, profiles, box statistics and histograms. Named versions can be saved and compared. In mentor mode the mentor sees the answers, can open every step and can write comments into the project.

The work is saved as a project file (`.astroproj`), so it can be continued later or sent to the mentor.

## Privacy and offline use

All data stays on the student's computer. The app uploads nothing, and it loads nothing from other servers: no CDNs, web fonts or analytics.

The app can be used without internet in two ways:

- **Installed web app:** open the address once while online. After that it also opens without a connection, and in Chrome, Edge and Safari it can be installed as an app. When a new version is published, the app offers to reload, but it never reloads by itself.
- **Offline file:** `astrofoto.html` contains the whole app in one file. It can be copied to a USB stick and opened by double-clicking, also on computers where nothing can be installed. Download it from the [latest release](https://github.com/astrotuvi/astrofoto/releases/latest).

## Data

The FITS data is not in this repository. The mentor gives it to the students. Instrument profiles describe how a telescope and camera write their headers. The built-in profile is for the AZT-12 telescope with an Andor camera. Support for more instruments is planned (see [docs/DESIGN.md](docs/DESIGN.md) §2.4).

## Development

Requires Node.js 20.19 or 22.12 or newer.

```sh
npm install
npm run dev            # development server at http://localhost:5173
npm test               # unit tests (Vitest, synthetic FITS files)
npm run typecheck
npm run build          # web app with service worker → dist/
npm run build:offline  # single offline file → dist-offline/astrofoto.html
```

For local development with real data, put the FITS files in `data/`, which git ignores.

The code is TypeScript with plain DOM code and Canvas 2D, built with Vite. The design, the data model and the code structure are described in [docs/DESIGN.md](docs/DESIGN.md).

### Publishing

- Every push to `main` runs the tests and deploys the app to GitHub Pages (`.github/workflows/pages.yml`). In the repository settings, Pages must use "GitHub Actions" as its source.
- To release a version, set `version` in `package.json` and push a matching tag, e.g. `v0.8.0`. The release workflow builds the offline file and attaches it to a GitHub Release (`.github/workflows/release.yml`).

## License

Copyright 2026 Taavi Tuvikene

Licensed under the [Apache License, Version 2.0](LICENSE).
