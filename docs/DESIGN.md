# Astrofoto – design document

A browser app for reducing monochrome CCD images in FITS format and combining them into colour images. It is built as a learning tool for an after-school astronomy project.

Status: milestones 1–8 (viewer, master frames, calibration and project file, alignment and stacking, colour and export, versions and mentor mode, report, publishing and offline use) implemented. Last updated 2026-11-02.

---

## 1. Purpose and audience

### 1.1 Goal

Students take raw CCD data through the whole reduction process:

1. sort the raw files,
2. build master calibration frames (bias, dark, flat),
3. calibrate the science frames,
4. align and stack them per filter,
5. combine the filters into a colour image.

At each step the student makes the decision and checks the result. The app explains, measures and verifies. It does not do the work for the student.

### 1.2 Users

- **Students** in grades 8–9 (põhikool, ages about 14–15). They are advanced for their age and take part in olympiads. They are comfortable with algebra, units and simple statistics once these are explained.
- **Mentor**: the person running the project. The mentor reviews the student's work, comments on it and sees the answer key.

### 1.3 How the app is used

- It is an **after-school project**, not a classroom lesson. Students work on their own, mostly at home, over several weeks.
- Because no teacher is present, the explanations and hints have to work on their own.
- Students send their work to the mentor (project file or report). The mentor's comments come back in the same project file.
- The project usually ends in a report, poster or presentation, for example for a student research competition.

### 1.4 Non-goals

These are left out on purpose, to keep the app small:

- One-shot colour (Bayer) cameras, debayering.
- Very large datasets (hundreds of frames, or a total beyond about 1.5 GB in memory): no workers, no disk cache, no GPU processing. Larger cameras are handled by software binning on import (§2.4).
- Distortion correction in alignment. Shift, rotation and the 180° meridian flip are supported (§3.3).
- Photometric or astrometric calibration (plate solving). WCS headers are only read for the pixel scale, if present.
- Server, accounts, sync between devices.

---

## 2. Data

The app is built and tested with one reference dataset (§2.1–2.3), but it must also work with data from **other telescopes and cameras** (§2.4). Everything specific to an instrument is kept in an **instrument profile**, never in the code.

The reference dataset is in `data/`, which is in `.gitignore`. **Data is never published with the app**: GitHub Pages hosts the app only. Students get data from their mentor (§3.1).

### 2.1 Contents

108 files, 56 MB, all taken with the same instrument setup:

| | |
|---|---|
| Telescope | AZT-12, focal length 12 000 mm, f/8 (`TELESCOP`, `FOCALLEN`) |
| Camera | Andor CCD, 1 MHz conventional 16-bit readout, at −60 °C |
| Binning | 2×2; `XPIXSZ = 26 µm` is the binned pixel size |
| Image | 524 × 512 px, `BITPIX = 16`, `BZERO = 32768` (unsigned 16-bit) |
| Orientation | `ROWORDER = 'TOP-DOWN'` |
| Software | N.I.N.A. 3.2 |

| Type (`IMAGETYP`) | Count | `FILTER` | `EXPTIME` | Date |
|---|---|---|---|---|
| BIAS | 25 | `NII` (no meaning for bias) | 0 s | 2026-10-21 |
| DARK | 5 | `NII` (no meaning for dark) | 30 s | 2026-10-21 |
| FLAT | 10 per filter | B, V, R, g, r, i | 1.2–12.9 s (twilight sky flats) | 2026-10-06 |
| LIGHT (M57) | 3 per filter | B, V, R, g, r, i | 30 s | 2026-10-21, all within 9 minutes |

### 2.2 Measured properties of the reference data

In this document, pixel coordinates are **1-based**, the convention used by FITS and DS9. The code works internally with 0-based indices.

| Observation | Consequence for the app |
|---|---|
| Columns 1–4 and 517–524 stay at bias level, even in flats (prescan/overscan). Columns 4 and 517 are partly exposed. | A **Trim** step comes before all other processing. The default region is x = 5–516 (512 columns) and y = 1–512. It is detected from the column profile of a flat, but the student finds it first (§4.2). |
| The bias level is about 1454 ADU, and the first rows are about 30 ADU lower. | A median master bias is used, not a single number. |
| The master dark (median of dark − bias) is about 4 ADU in 30 s, roughly 0.13 ADU/s, with a few warm pixels up to about 90 ADU. Single darks have cosmic-ray hits up to about 5000 ADU. | The darks match the light exposure (30 s), so no scaling is needed. The dark still removes the warm pixels, and the median removes the cosmic rays. Flats only have the bias subtracted by default. |
| Flat levels vary from about 30 000 to 43 000 ADU within a filter. | Each flat **must** be divided by its own median before combining. |
| Flats are from a different night than the lights. | Master flats are matched to lights **by filter only**, not by date. |
| `R` (Johnson) and `r` (Sloan) are different filters. | Filter names are **case-sensitive** and never changed. Bias and dark frames ignore `FILTER`. |
| The same bright stars appear in all 18 lights. The drift is up to about 4.2 px (V frames), with no rotation (< 0.03°). It wanders rather than growing steadily: the last frame is 2.3 px from the first. Only 4–6 stars stand out in g and B; the bright knots of M57 look like stars to a simple peak finder. | Alignment corrects **shift only**, measured to a fraction of a pixel (scatter 0.05–0.2 px). Star finding rejects peaks that do not stand out at least 5× the scatter of the ring around them. |
| There are 3 lights per filter. | **Median** stacking is the default: it removes cosmic rays. Sigma clipping is pointless with 3 frames. |
| The sky background differs by filter, roughly 560–1300 ADU above bias in the stacks (B lowest), with a noise of 20–31 ADU. The brightest stacked pixel ranges from about 14 000 ADU (B) to 59 000 ADU (r). | An automatic black point for each channel: the background median, which makes the sky equally dark in every channel. The white points differ by channel, so the colour balance is set per channel. |
| The brightest star peaks at about 62 000 ADU raw in r and i. | A saturation overlay, with an adjustable level (default 60 000 ADU raw). |
| Plate scale 206 265 × 0.026 / 12 000 ≈ 0.45″/px, so the field is about 3.8′. | Measuring tools can show arcseconds, computed from header values. |

The fixed numbers in this table (trim region 5–516, saturation level 60 000 ADU, 30 s darks) are the **built-in profile "TO AZT-12 + Andor"** (§2.4). They are not constants in the code.

### 2.3 Colour combinations offered

- **B, V, R** → blue, green, red channels
- **g, r, i** → blue, green, red channels
- Any other mapping the student chooses, e.g. Hα / OIII / SII narrowband.

The app suggests a mapping from the filter names it recognises (a filter → wavelength table in the profile), sorted from short to long wavelength. Unknown filter names are left for the student to assign.

### 2.4 Data from other telescopes

#### Instrument profile

An **instrument profile** collects everything that differs between telescopes and cameras:

| Setting | Example (reference data) | If missing |
|---|---|---|
| Name | "TO AZT-12 + Andor" | — |
| Header keyword aliases (frame type, filter, exposure, temperature, binning, date) | `IMAGETYP`, `FILTER`, `EXPTIME` | Built-in alias list (below) |
| Frame type values | `BIAS`, `DARK`, `FLAT`, `LIGHT` | Built-in value list (below) |
| Trim region | x = 5–516, y = 1–512 | Detected from a flat; "none" is a valid result |
| Saturation level | 60 000 ADU | `SATURATE` or `DATAMAX` header, else 95 % of the `BITPIX` maximum |
| Pixel scale | from `FOCALLEN` + `XPIXSZ` | WCS (`CDELT`/`CD`), else entered by hand, else measuring in px only |
| Pixel size includes binning? | yes | Asked once, with an explanation (N.I.N.A. writes the binned size, some other programs the unbinned size) |
| Gain (e⁻/ADU) | — | `GAIN`/`EGAIN` header; noise in electrons is only shown when known |
| Filter → wavelength table | B, V, R, g, r, i | Built-in list for Johnson-Cousins, Sloan, LRGB and narrowband |
| Image orientation | `ROWORDER = TOP-DOWN` | FITS default, bottom-up |

- The app ships with **built-in profiles**, starting with the reference instrument. More are added as new datasets come in.
- On import, the app **picks the profile** from `TELESCOP`/`INSTRUME`. If none matches, it creates a new profile from the headers and the built-in defaults, and the student checks it on a profile page.
- The profile is **saved in the project file**, and can be exported and imported as a small JSON file. A mentor can then give students a ready profile for a new telescope.
- Checking and completing the profile counts as part of the learning: reading a FITS header is a skill in its own right.

#### Header variations

Different capture programs write headers differently. The built-in defaults handle the common cases:

| Concept | Keywords tried, in order |
|---|---|
| Frame type | `IMAGETYP`, `FRAMETYP`, `OBSTYPE` |
| Filter | `FILTER`, `FILTER1`, `FILTNAM`, `FILTERS` |
| Exposure | `EXPTIME`, `EXPOSURE`, `ITIME` |
| Temperature | `CCD-TEMP`, `CCDTEMP`, `TEMPERAT` |
| Binning | `XBINNING`/`YBINNING`, `CCDXBIN`/`CCDYBIN`, `BINNING` |
| Date | `DATE-OBS`, `DATE`, `MJD-OBS` |

| Frame type | Values recognised (case-insensitive) |
|---|---|
| Bias | `bias`, `bias frame`, `zero` |
| Dark | `dark`, `dark frame` |
| Flat | `flat`, `flat field`, `flat frame`, `skyflat`, `domeflat` |
| Light | `light`, `light frame`, `object`, `science` |

If the headers say nothing, the app guesses from the **file name** (e.g. `BIAS-…`, `_flat_`). The student can always correct the type and filter in the file table.

#### Consistency checks

On import and before calibration, the app checks for and explains:
- frames of different sizes or binning in one calibration set,
- darks with a different exposure from the lights (offers scaling, and explains it),
- darks at a different temperature (warns),
- lights with no master flat for their filter,
- a total memory estimate above the limit (offers binning, below).

#### Size limits

- At import, the app estimates the memory needed: pixels × 4 bytes × number of frames, plus the masters and stacks.
- Above about 1.5 GB, it offers **software binning on import** (2×2 or 3×3, averaging pixels).
  - This is also a teaching point: binning, resolution and noise.
  - The binning factor is recorded in the profile and in the log, and the pixel scale is adjusted.
- Typical amateur and student cameras (up to about 16 megapixels, a few dozen frames) work without binning.

#### Compressed files

- `.fits.gz`: read with `fflate`, in milestone 1.
- Tile-compressed `.fz` (Rice): later milestone, if a dataset needs it.
- FITS with extensions: the first HDU with image data is used.

---

## 3. Workflow

```
[1. Failid]  →  [2. Kalibreerimine]  →  [3. Joondamine ja liitmine]  →  [4. Värv]
 Files            Calibration             Alignment and stacking          Colour
```

Steps unlock in order. A finished step can be reopened at any time. Changing it marks the later results as out of date, and they are recomputed.

### 3.1 Files

- Load files by drag and drop or a folder picker (`<input webkitdirectory>`). The data comes from the mentor, e.g. as a zip file or a shared folder. Zip files can be dropped in directly; the app unpacks them.
- **Starting project:** the mentor can load a dataset, check the instrument profile and task settings, and save it as an `.astroproj` file. Students open that file and start with all frames already in place. This is the simplest way to hand out data.
- The instrument profile is chosen or created (§2.4).
- Each file is sorted by its headers through the profile's keyword aliases: frame type, filter, exposure, date. If these are missing, the file name is used.
- A table shows the files grouped by type and filter. The student can correct the type and filter, and exclude individual frames.
- Clicking a file opens the image and its **header viewer**. The important keywords have tooltips.

### 3.2 Calibration

1. **Trim**: choose the exposed region. Many cameras have no overscan in their files, and then this step only confirms "no trimming needed".
2. **Master bias** (eelpingekaader): median of the bias frames.
3. **Master dark** (pimekaader): median of (dark − master bias). It is scaled by `t_light / t_dark` when the exposures differ.
4. **Master flat** (tasaväljakaader), one per filter:
   1. subtract the master bias from each flat (subtracting the scaled dark is optional);
   2. divide each flat by its own median;
   3. take the median of the results.
5. **Apply** to each light:

   ```
   calibrated = (light − master bias − master dark) / master flat
   ```

   The master flat is already normalised to 1, so the brightness level stays the same.

The student can switch each of bias, dark and flat **on or off** to see the effect of leaving it out (§4.4).

### 3.3 Alignment and stacking

1. The student picks a reference frame (default: the first frame in time).
2. **The student does it by hand first:** click 1–3 stars in each frame. The click snaps to the star's centre, computed as the brightness-weighted average position in a small box.
   - With 1 star, the app corrects a **shift**.
   - With 2 or more stars, it corrects **shift + rotation**. Rotation is needed for data from several nights, or after a **meridian flip** on an equatorial mount, which rotates the image by 180°.
3. **Automatic check:**
   1. find the bright stars;
   2. try matching them by nearest neighbour (within 15 px). If too few stars match, try again after rotating by 180° (meridian flip). If that also fails, use triangle patterns of the brightest stars, which works for any rotation;
   3. fit the shift (and rotation, if the student chose it) by least squares.
   The app shows its result next to the student's. The student chooses which one to use.
4. Each image is transformed with bilinear interpolation, then cropped to the area all frames cover.
5. The aligned frames of each filter are stacked, by median (default) or mean. With 5 or more frames, **sigma-clipped mean** is offered as well, with an explanation under "Uuri lähemalt".
6. After one filter has been done by hand, a **"Tee sama ülejäänud filtritega"** button (do the same for the other filters) is available. It aligns the frames of the other filters automatically; they still appear in the comparison.

In the app the step has three parts: **Käsitsi** (by hand: reference, model, clicked stars), **Automaatne kontroll** (the app's result next to the student's, the difference at the frame corners, the choice per frame, then confirming) and **Liitmine** (stacking). The reference frame is shared by all filters, so the stacks of different filters line up for the colour step. Clicked stars are shown as numbered circles, and the reference stars as dashed circles in the other frames, the aligned frames and the stacks: after alignment the stars must sit inside them. Changing the reference or the model clears the alignment (the clicked stars are kept).

### 3.4 Colour

- One or more **compositions**, each mapping stacked filter images to the R, G and B channels. The student chooses the filters; the table of stacks shows each filter's wavelength, and a check says whether the mapping goes from short (blue) to long (red) wavelength, is reversed, mixed ("false colour") or unknown. The same filter may go into two channels.
- Settings for each channel: black point (the "Auto" button sets it to the background median), white point, weight (colour balance). A newly chosen filter starts at the full range of its stack (minimum to maximum), so the linear image looks nearly black, as in §4.2.
- Channel brightness = stretch(weight × (value − black) / (white − black)), clipped to 0–1.
- Stretch: linear or asinh, `asinh(t·x) / asinh(t)` with strength t (1–1000, default 100), applied to each channel separately.
- The image updates live as settings change: sliders change the image and the histograms without rebuilding the panel. The white point slider is logarithmic above the background, so faint and bright settings both fit.
- The histogram of each channel is shown, around the background, with the black and white points.
- **Check:** the background brightness of each channel on the 0–255 scale. It should be equal (neutral sky); otherwise the app names the tint and points to "Auto" and the weights.
- The colour image is shown in the viewer, where the pixel readout gives the stack value behind each channel. It has no display range or measuring tabs of its own.
- In the app the step has two parts: **Värvipilt** (colour image) and **Failide salvestamine** (saving files, §3.5).

For the reference data, BVR shows the ring of M57 red outside and blue-green inside; in gri the ring is green, because Hα falls into r, which is in the green channel. Task 14 builds on this difference.

### 3.5 Export

- **PNG** of the colour image, at 1× or 2× size, the right way up (`ROWORDER`). 2× is smoothed rather than blocky and is meant for posters. Saving the PNG marks the colour step as done.
- **FITS**: master frames and stacked images per filter, as 32-bit floats, one at a time or all in one zip.
  - `CHECKSUM` and `DATASUM` are removed, because the data has changed.
  - The processing steps are written as `HISTORY` lines (trim, masters, calibration, alignment, crop, stacking), followed by the app version and date.
  - File names are `master-bias.fits`, `master-flat-<filter>.fits`, `stack-<filter>.fits`. Filters that differ only by case (R and r) get their system added (`stack-R-johnson-cousins.fits`, `stack-r-sloan.fits`), because Windows and macOS file names ignore case.
- **Figures**: profiles, histograms and comparisons as PNG files with axis labels.
- **Report** (§4.6): `.docx` for Google Docs or Word, copying section by section, a zip of figures, and PDF through printing.

---

## 4. Educational design

### 4.1 Principles

- **Look, decide, do, check.** In each step the student first looks at the data, then makes the decision, then sees the result and checks it with measurements.
- **Automatic suggestions are shown after the student's own choice**, as a check, never instead of it.
- **Real formulas and real numbers.** The notation is simple and each formula has a sentence explaining it. Nothing is hidden behind "magic".
- **Self-study.** Every explanation and hint must make sense without a teacher present.
- **Predict, then measure.** Where possible, the student calculates the expected result before measuring it.

### 4.2 Explanations

Each step has a **"Miks?"** panel (Why?). It is open the first time and can be collapsed. It covers:
- what the step fixes, in 3–6 sentences, with a comparison where it helps;
- the formula;
- what goes wrong if the step is skipped;
- a small diagram.

Topics beyond the school curriculum go in a collapsed **"Uuri lähemalt"** section (Find out more). Examples: sigma clipping, interpolation methods, how a CCD is read out, why overscan exists.

The first image is shown **linear and unstretched**, so it looks nearly black. The student sees why stretching is needed before the stretch controls appear.

### 4.3 Measuring tools (available in all steps)

| Tool | Shows |
|---|---|
| Pixel readout | x, y (1-based), value in ADU |
| Row/column profile | A line plot along a row or column, with labelled axes |
| Box statistics | Mean, median, standard deviation, minimum and maximum of a dragged rectangle |
| Histogram | Linear or logarithmic axis |
| Star profile | Radial profile and FWHM (the student estimates it by hand first, then the app computes it) |
| Distance | In pixels and arcseconds (from `FOCALLEN` and `XPIXSZ`) |
| Compare | Blink or split view between the image shown (A) and another image or the same image in a saved version (B), in the same display range |
| Saturation overlay | Pixels above the saturation level shown in red |

Each statistic has a short tooltip, e.g. *standardhälve: how much the values spread around the mean*.

### 4.4 "What if…?" experiments

- Each calibration step can be switched on or off, and the median vs mean choice can be changed.
- The result can be saved as a **named version**, e.g. "ilma tasaväljata" (without flat).
- Versions can be compared side by side (a split line) or by blinking, in the viewer's **"Võrdle"** tab (compare).
- Tasks can ask for an experiment directly (§4.5); the "no flat" task asks for a version and blinking.

A version stores the processing settings. When compared, its images are recomputed from the frames with its calibration and stacking choices (trim, bias/dark/flat on or off, combine methods), but with the **current** alignment and steps done, so a version saved during calibration can be compared after stacking too. The version list says how each version differs from the current settings. Images are kept for the two most recently compared versions; for the reference data one version takes about 0.9 s and 50 MB. Versions are saved in the project file; their images are not.

### 4.5 Tasks

Each step has 1–3 tasks. Most are **numerical**: the app checks the answer within a tolerance. Others are short **free-text** answers that the mentor reads.

The **expected values are computed from the student's own data**, so the tasks also work with other datasets. Each task also states what it needs, e.g. "needs pixel scale", "needs an overscan region" or "needs darks". A task whose needs are not met is hidden, or replaced by an explanation of why it does not apply to this camera. Object-specific values, such as the distance in task 13, are given by the mentor in the task settings rather than written into the task text.

When an answer is wrong, the app does not reveal the correct value. It offers hints in levels:
1. a direction (*"Which header keyword gives the exposure time?"*),
2. the method (*"Divide (dark − bias) by the exposure time."*),
3. the full explanation, available after a few attempts.

The number of attempts and hints used is saved for the mentor.

Planned tasks for the reference dataset:

| # | Step | Task | Expected (reference data) |
|---|---|---|---|
| 1 | Files | Which header keywords tell the frame type, filter and exposure time? | `IMAGETYP`, `FILTER`, `EXPTIME` |
| 2 | Trim | From a flat's column profile, find the first and last column that receives light. Why do unexposed columns exist? (Only if the camera has overscan.) | 5 and 516 |
| 3 | Bias | Measure the mean and noise of one bias frame. | ≈ 1454 ADU, noise to be measured |
| 4 | Bias | Predict the noise of a master bias made of 25 frames, then measure it. | ≈ 1/5 of a single frame (1/√N) |
| 5 | Dark | Calculate the dark current in ADU/s. Is a dark frame needed? What does it still fix? | ≈ 0.13 ADU/s; hot pixels |
| 6 | Flat | Measure the normalised master flat in the centre and the four corners. How much darker is the darkest corner, in %? Is it vignetting? | 6–13 % depending on filter; one side is darker (a slope from the twilight sky), not all edges |
| 7a | Calibration | Measure the sky background before and after calibration. How much did it drop, and why? | ≈ 1458 ADU (bias + dark) |
| 7 | Calibration | Calibrate without the flat and compare the background at the centre and the edge. | experiment |
| 8 | Header | Calculate the plate scale in ″/px and the field of view in ′. | ≈ 0.45″/px, ≈ 3.8′ |
| 9 | Alignment | How large is the shift between the first and last frame, in px and ″? What causes it? | ≈ 2.3 px ≈ 1.0″ (up to ≈ 4.2 px in between); tracking |
| 10 | Stacking | Find a cosmic-ray hit. Which stacking method removes it, and why? | median |
| 11 | Stars | Measure the FWHM of a star in px and ″ (seeing). | to be measured |
| 12 | Saturation | Find saturated or nearly saturated stars. Why can their brightness not be measured? | r, i |
| 13 | Object | Measure the object's size in ″ (for M57: the ring diameter). Convert it to light years, using the distance the mentor has set. | to be measured |
| 14a | Colour | Which channel does the filter with the shortest wavelength go into, and why? | blue |
| 14 | Colour (extension) | Compare a star's brightness in B and V, which introduces the colour index B−V. Why do the BVR and gri images differ? | discussion |

Task definitions are stored in separate files (§6), so the mentor can add or change them.

### 4.6 Report

The report is one of the app's most important outputs. It is rarely the final document: students **merge it into a larger document**, most likely in Google Docs, together with their own introduction, background and conclusions. The report is therefore designed for **moving text and images into another document** easily, not only for printing.

#### Building the report

- Any figure or measurement in the app has an **"Lisa aruandesse"** button (add to report). It saves a snapshot: the image or plot with its current settings, and the numbers.
- The **report page** lists the collected items in order. The student can reorder them, remove them, and edit the figure captions.
- These sections are added automatically, and each can be turned off:
  - title, student name, date. Without a project title, the report, the project file and the exported files use "Minu projekt" (my project), never the object name;
  - data description: object, telescope, camera, filters, number of frames and exposures, from the headers;
  - processing steps, with formulas and parameters, written as readable sentences from the log, not as a raw log;
  - the tasks with the student's answers and measured values;
  - the final colour images.
- Mentor comments are **left out by default**, because they are feedback, not part of the student's work. They can be included for the mentor's own copy.
- The report is written in the current language. Switching language and exporting again gives the other language.

#### Getting it into Google Docs (or Word)

There are three ways, from most to least complete:

| Way | How | Result |
|---|---|---|
| **1. Download `.docx`** | "Laadi alla Word-fail" (download Word file). In Google Drive, open the file with Google Docs. From there, copy sections into the master document. | Everything arrives: headings, text, tables, images, captions. Copying between two Google Docs keeps all formatting. |
| **2. Copy section by section** | Each section on the report page has a **"Kopeeri"** button (copy). Each figure has its own "Kopeeri pilt" button (copy image). Paste into the master document. | Text and tables are pasted with formatting. Images are pasted one by one. |
| **3. Download figures** | "Laadi alla joonised (.zip)" (download figures). Insert them in the master document with Insert → Image. | Full-resolution PNG files, named by figure number, e.g. `joonis-03-tasavaljakaader.png`. |

A **PDF** (through the browser's print dialog) is still available, for printing or for sending to the mentor, but it is not meant for further editing.

#### Formatting rules for easy transfer

The report uses only structures that survive copying into Google Docs and Word without manual fixing:

- **Headings** are real heading levels (H1–H3), which become Google Docs "Heading 1–3". The master document's own style then applies automatically.
- **Plain text styles**: no custom fonts, colours or backgrounds. Bold and italics only.
- **Tables are real tables**, not pictures, with simple cells (no merged cells), so the numbers can be edited and the table restyled.
- **Formulas are plain text** with Unicode characters, e.g. `σ₂₅ = σ₁ / √25`. Google Docs does not accept pasted MathML or LaTeX.
- **Numbers** use the language's decimal separator (comma in Estonian) and always have units.
- **Figures are self-contained PNG images**:
  - axis labels, units, legends and a scale bar in arcseconds (when the pixel scale is known) are drawn into the image, so the figure makes sense without the app;
  - the text inside figures uses the report language;
  - a fixed width of 1600 px gives a sharp image at full page width (16 cm) in print;
  - plots have a white background, so they look right in a document even if the app is in a dark theme.
- **Captions are separate text** below each image, e.g. *"Joonis 3. Normeeritud tasaväljakaader filtris g. Servad on keskmisest 8 % tumedamad."*, so they can be edited and become part of the master document's text. Figures and tables are numbered automatically.
- **No page layout tricks**: no columns, text boxes or floating images. Each image is on its own line, so it does not move around when pasted.

#### Technical notes

- The report is built once as a **simple document model**: a list of headings, paragraphs, tables, figures and captions. It is then rendered three ways: as HTML for the report page and copying, as `.docx`, and as figure files. This keeps all three versions consistent.
- `.docx` is written in the browser as plain Office Open XML and zipped with `fflate`, so it works offline and adds no library. The report only needs heading styles named "heading 1–3", paragraphs with bold and italic, tables with simple cells and direct borders, inline PNG images 16 cm wide, and a "caption" style. The text font is Arial, the Google Docs default, so pasted text looks native.
- "Lisa aruandesse" is in the viewer: next to the image picker (the image as shown, with its display range, the zoomed part and the box or profile line of the open tab; a colour image with a copy of its settings), and under the profile, histogram and box statistics results. On the report page the student can also add their own text paragraphs.
- Captions left empty are written by the app in the current language, e.g. *"Koondkaader: tasaväljakaader g. Hallskaala 0,971…1,055."* Figures and tables are numbered through the whole report; figure files are named after the number and the item, e.g. `joonis-01-koondkaader-tasavaljakaader-g.png`.
- Figures whose image does not exist any more (a step undone, a version removed) show a note instead of the image.
- The **"Kopeeri"** button writes both `text/html` and `text/plain` to the clipboard (Clipboard API). "Kopeeri pilt" writes `image/png`. This works in Chrome, Edge, Safari and recent Firefox versions.
- Whether Google Docs accepts images embedded in a copied HTML section is not reliable (images given as `data:` URLs are often dropped). So sections are copied as text and tables (a figure leaves its caption, so the image can be pasted above it), and images are copied separately. Pasting into the current Google Docs and Word still has to be tried by hand (§8). If embedded images turn out to paste reliably, sections can include them.
- Sending the report directly to Google Docs through the Google API is a **non-goal**: it needs a Google sign-in and a connection, which conflicts with offline use and keeping data on the student's computer.

### 4.7 Mentor mode

A switch in the footer (with a confirmation), saved in the browser (`localStorage`), not in the project file. A badge in the top bar shows when it is on. It:
- shows the answer key for the tasks: the expected values with their tolerance, the right choice or keyword, and the student's wrong attempts and hints opened;
- shows all hint levels at once, without counting them as the student's;
- allows opening any step and part regardless of the order (stacking still needs a confirmed alignment);
- shows automatic suggestions immediately (the trim suggestion, the automatic alignment check);
- lets the mentor write **comments** on each step or task. The comments are saved in the project (`mentorComments`, keyed `step:<id>` or `task:<id>`). The student sees them at the top of the step or below the task, and on the "Kus ma pooleli jäin" page, which opens with the project.

The answer key is part of the app code, so a determined student could find it. For this group that is acceptable. Hiding it properly would need a server.

---

## 5. Language support

- **Estonian is the default**, English the alternative. The switch is in the top bar.
- The language choice is saved in the browser (`localStorage`), not in the project file.
- `<html lang>` is set to match the language.
- Interface strings are accessed through `t('key')`. Keys are typed, so TypeScript reports any string that is missing in either language.
- Numbers are displayed with `Intl.NumberFormat` (decimal comma in Estonian). FITS headers and exported files always use a decimal point.
- Explanations and tasks are Markdown files per language, rendered with `marked`.
- The Estonian text is written first, and the English text is translated from it.

### 5.1 Glossary

The glossary is defined once, in `src/i18n/glossary.ts`. Each term has a one-sentence explanation in both languages, used in tooltips and on a separate glossary page.

| English | Estonian |
|---|---|
| bias frame | eelpingekaader (also: bias-kaader) |
| dark frame | pimekaader |
| flat frame | tasaväljakaader |
| light frame | objektikaader |
| master frame | koondkaader |
| median / mean | mediaan / keskmine |
| overscan | ülelugemisala |
| stretch | venitus |

The first time "eelpingekaader" appears in a text, "(bias-kaader)" follows it in brackets.

---

## 6. Technical design

### 6.1 Technology

| Concern | Choice |
|---|---|
| Language and build | TypeScript with Vite |
| UI | Plain DOM code, no framework |
| Image display | Canvas 2D (`ImageData`) |
| Processing | Main thread, `Float32Array`, everything kept in memory |
| Zip | `fflate` |
| Markdown | `marked` |
| Report `.docx` | written directly as Office Open XML, zipped with `fflate` |
| Offline | `vite-plugin-pwa` (service worker), `vite-plugin-singlefile` (offline file) |
| Hosting | GitHub Pages (static files) |

All data stays in the browser: nothing is uploaded. The app loads nothing from other servers: no CDNs, web fonts or analytics. All code, styles, fonts, explanations and tasks are bundled with the app. The reference dataset takes about 110 MB as float32, which is fine on an 8 GB laptop.

### 6.2 Browser support

All modern browsers (Chrome, Edge, Firefox, Safari). The File System Access API is used where it exists, with a fallback elsewhere:

| | Chrome / Edge | Firefox / Safari |
|---|---|---|
| Open files | `showOpenFilePicker`, drag and drop, folder picker | `<input type="file">`, drag and drop, folder picker |
| Save project | `showSaveFilePicker`; then Ctrl+S overwrites the same file | Download (`<a download>`); each save is a new file |
| Export | Save dialog | Download |

The app warns before the tab is closed with unsaved changes.

### 6.3 Offline use

The app must work on the student's computer **without an internet connection**. Processing already happens entirely in the browser, so only loading the app itself needs to work offline. There are two ways to get it.

#### A. Installed web app (PWA), the main way

- The student opens the GitHub Pages address once while online. A **service worker** stores all the app's files in the browser.
- After that, the app opens from the same address, or from the installed icon, **without a connection**.
- In Chrome and Edge, the app can be **installed** with the install button in the address bar. It then gets its own window and a desktop or dock icon. In Safari (macOS 14+) the same is done with "Add to Dock". Firefox does not install PWAs, but the offline cache still works when the address is opened in a tab.
- **Updates:** when the app is online and a new version exists, the app shows the message "Uus versioon on saadaval" (a new version is available) with a button to reload and a "Hiljem" (later) button. If the project has unsaved changes, the message asks to save first, and the usual unsaved-changes warning still applies. It never reloads by itself, so work in progress is not interrupted. The browser looks for a new version when the app is opened and the app looks again every hour; the About page also has a "Otsi uuendusi" (check for updates) button.
- **Install button:** where the browser offers it (Chrome, Edge), the About page has its own "Paigalda rakendus" button, next to short install instructions for each browser.
- **Icons:** `favicon.svg` (the Ring Nebula M57), PNG icons of 192 and 512 px, a maskable 512 px icon and an Apple touch icon, all in `public/`.
- The **app version** is shown on the About page ("Teave", linked from the footer) and saved in the project file (§6.5).
- **Publishing:** the workflow `.github/workflows/pages.yml` runs the tests, builds and deploys `dist/` to GitHub Pages on every push to `main`. Pages must be set to "GitHub Actions" as its source in the repository settings.

#### B. Offline file (`astrofoto.html`), the fallback

- A single HTML file with all code, styles and texts inlined, built with `vite-plugin-singlefile`.
- It can be copied to a USB stick or emailed, and opened by double-clicking. This works on computers where the student cannot install anything, and where the GitHub Pages address has never been opened.
- Opened from `file://`, the app works fully, but:
  - it does not update itself; a new version means a new file;
  - `localStorage` (language, mentor mode) may be shared with other local files or cleared more often, so the app always works with the defaults.
- The offline file is published as a **GitHub Release** attachment with each version, and linked from the About page (`releases/latest/download/astrofoto.html`).
- **Building it:** `npm run build:offline` writes `dist-offline/astrofoto.html`. In this mode the service worker registration is replaced by `src/pwa-none.ts`, nothing is copied from `public/`, and the icon is inlined as a data URL.
- **Releasing:** pushing a tag `vX.Y.Z` that matches the version in `package.json` runs `.github/workflows/release.yml`, which runs the tests, builds the offline file and creates the release with it attached.

#### What must not depend on the network

| Feature | Offline |
|---|---|
| All processing, tools, tasks, hints, explanations, glossary | ✓ bundled |
| Opening and saving project files, exports, reports | ✓ local files |
| Language switch | ✓ both languages bundled |
| Data | ✓ always local files from the mentor; nothing is downloaded by the app |
| Updates | only when online |

### 6.4 FITS input and output

- **Reading:**
  - 2880-byte header blocks; `CONTINUE`, `COMMENT` and `HISTORY` cards are kept.
  - `BITPIX` 8, 16, 32, −32 and −64; `BZERO`/`BSCALE`; data is big-endian.
  - Everything is converted to `Float32Array` on load.
  - `ROWORDER` is checked so the image is displayed the right way up.
  - `.fits.gz` files are decompressed with `fflate`. Files with extensions use the first HDU that has image data.
  - Header values are read through the profile's keyword aliases (§2.4), never by fixed keyword names in processing code.
- **Writing:**
  - `BITPIX = −32` (32-bit float).
  - Headers are copied from the source, with `CHECKSUM` and `DATASUM` removed.
  - The processing steps are added as `HISTORY` lines.

### 6.5 Project file (`.astroproj`)

A zip file with this layout:

```
project.json      settings, decisions, answers, comments, log
frames/<name>     the original raw files as loaded (also .fits.gz), unchanged
```

- The raw files are stored inside, so the project is a **single file**. It can be emailed and never has broken file references. For the reference dataset it is about 40 MB (raw data compressed at zip level 1).
- Master frames, stacks and versions are **not stored**. They are recomputed from `project.json` when the project is opened. For the reference dataset, opening and saving each take under 2 s.
- Renaming the file to `.zip` shows its contents, which helps with debugging.
- When a project is opened, a **"Kus ma pooleli jäin"** page (where I left off) shows the finished steps, the open tasks and the last log entries.
- `project.json` records the format version and the app version that saved it. A project from a newer app version opened in an older one (e.g. an old offline file) shows a warning; a newer *format* version cannot be opened. Older projects are upgraded on open.

### 6.6 Data model

```ts
type Kind = 'bias' | 'dark' | 'flat' | 'light';
type StepId = 'files' | 'trim' | 'bias' | 'dark' | 'flat' | 'calibrate'
            | 'align' | 'stack' | 'color';

interface FrameMeta {
  id: string;
  fileName: string;              // path inside frames/
  kind: Kind;
  filter: string;                // case-sensitive; '' for bias/dark
  exposure: number;
  dateObs: string;
  width: number; height: number;
  header: Record<string, string | number | boolean>;
  excluded?: boolean;
}

interface InstrumentProfile {
  id: string;
  name: string;                  // e.g. "TO AZT-12 + Andor"
  match?: { telescop?: string; instrume?: string };
  keywords: Partial<Record<'kind' | 'filter' | 'exposure' | 'temperature'
                         | 'xbin' | 'ybin' | 'date', string[]>>;
  kindValues: Partial<Record<Kind, string[]>>;
  trim: { x0: number; x1: number; y0: number; y1: number } | null;  // 0-based, inclusive; null = none
  saturationLevel?: number;      // raw ADU
  pixelScale?: number;           // arcsec/px, after binning; overrides header values
  pixelSizeIncludesBinning?: boolean;
  gain?: number;                 // e-/ADU
  importBinning: 1 | 2 | 3;      // software binning on import
  filters: Record<string, { wavelengthNm: number; system?: string }>;
}

interface ProcessingSettings {
  trim?: { x0: number; x1: number; y0: number; y1: number } | null;  // undefined = not decided; null = no trimming
  useBias: boolean; useDark: boolean; useFlat: boolean;  // applied to the lights; masters are built regardless
  darkForFlats: boolean;
  combine: Record<'bias' | 'dark' | 'flat' | 'stack', 'median' | 'mean' | 'sigmaClip'>;
  sigmaClip?: { low: number; high: number };   // default 3σ / 3σ, σ from the median absolute deviation
  saturationLevel: number;       // raw ADU
  referenceId?: string;          // undefined = first light in time
  alignModel: 'shift' | 'shiftRotation';
  // q = R(rotation)·(p − c) + c + (dx, dy): frame point p → reference point q, in raw (untrimmed)
  // 0-based coordinates, c = centre of the raw frame. Raw coordinates keep them valid when the trim changes.
  transforms: Record<string, { dx: number; dy: number; rotation: number /* rad */; source: 'manual' | 'auto' }>;
  manualStars: Record<string, [number, number][]>;  // raw coordinates; star k matches star k of the reference
}

interface Composition {
  id: string;
  name: string;                  // e.g. "BVR"
  channels: Record<'R' | 'G' | 'B', {
    filter: string | null; black: number; white: number; weight: number;
  }>;
  stretch: { type: 'linear' | 'asinh'; strength: number };
}

interface Project {
  version: 1;                    // project file format
  appVersion: string;            // app version that last saved the project
  title: string;
  student: string;
  created: string; lastOpened: string;
  profile: InstrumentProfile;
  frames: FrameMeta[];
  settings: ProcessingSettings;
  taskSettings: Record<string, Record<string, number | string>>;  // e.g. object distance, set by mentor
  versions: { id: string; name: string; settings: ProcessingSettings; created: string }[];
  compositions: Composition[];
  steps: Partial<Record<StepId, { done: boolean; acceptedAuto?: boolean }>>;
  answers: Record<string, { value: string; correct?: boolean; attempts: number }>;  // key: <taskId>.<partId>
  hintsUsed: Record<string, number>;                    // hint levels opened, per task
  mentorComments: Record<string, { text: string; date: string }[]>;  // key: step:<id> or task:<id>
  report: {
    sections: Partial<Record<'title' | 'data' | 'processing' | 'tasks' | 'colour' | 'mentorComments', boolean>>;
    items: ReportItem[];         // in report order
  };
  log: { date: string; step: StepId; message: string; params: Record<string, unknown> }[];
}

interface Task {
  id: string;
  step: StepId;
  answerType: 'number' | 'text' | 'choice';
  expected?: (ctx: MeasureContext) => number;   // computed from the student's own data
  tolerance?: number;                           // relative, e.g. 0.1
  unit?: string;
  hints: number;                                // number of hint levels in the content file
  requires?: ('pixelScale' | 'trim' | 'darks' | 'flats' | 'gain')[];
}

interface ReportItem {
  id: string;
  snapshot:                      // what to redraw; image ids as in the viewer, e.g. 'master:flat:g'
    | { type: 'image'; imageId: string; range: { mode; black; white }; view: Region | null; box?; line? }
    | { type: 'color'; composition: Composition; view: Region | null }   // a copy of its settings
    | { type: 'profile'; imageId: string; axis: 'row' | 'column'; index: number }
    | { type: 'histogram'; imageId: string; box: Region | null; log: boolean; range: 'full' | 'clipped'; black; white }
    | { type: 'boxStats'; imageId: string; box: Region }                  // becomes a table
    | { type: 'text'; text: string };                                     // the student's own paragraph
  caption: string;               // edited by the student; '' = automatic, in the current language
  added: string;
}
```

The report items store **how to redraw** a figure, not the image itself. Images are rendered when the report is exported, so they always match the current language and processing.

### 6.7 Code structure

```
src/
  main.ts              app start, step navigation
  types.ts             shared data model (§6.6)
  state.ts             Project + in-memory frames, change events, out-of-date flags
  dom.ts               small DOM helper
  fits.ts              FITS reader and writer (incl. .fits.gz)
  import.ts            dropped/picked files and zips → frames
  instrument/
    profile.ts         profile matching, header access through aliases, consistency checks
    defaults.ts        built-in keyword aliases, frame type values, filter wavelengths
    profiles/*.json    built-in profiles, starting with to-azt12-andor.json
  stats.ts             median, mean, standard deviation, percentiles, histogram
  calibrate.ts         trim, combine, master bias/dark/flat, trim detection, apply calibration
  masters.ts           builds master frames from the state, rebuilds them when inputs change
  checks.ts            consistency checks (§2.4)
  align.ts             centroid, star finding, matching (nearest neighbour, 180° flip, triangles),
                       shift/rotation fit, bilinear transform, common crop
  stack.ts             reference frame, manual and automatic transforms, aligned frames,
                       common crop and stacks per filter, built from the state
  color.ts             channel mapping, black/white point, stretch → RGBA, background check,
                       wavelength order
  export.ts            FITS files of masters and stacks (names, zip), PNG of a colour image
  viewer.ts            canvas display, zoom/pan, overlays, click handling
  versions.ts          named versions: save, compute their images, differences
  mentor.ts            mentor mode switch (localStorage)
  project.ts           .astroproj format: serialize, open, migrate
  fileio.ts            File System Access with download / <input> fallback
  log.ts               processing log
  report/
    model.ts           report document model (headings, paragraphs, tables, figures, captions)
    build.ts           builds the model from the project, automatic captions
    figures.ts         renders figures to PNG (fixed width, labels, scale bar, white background)
    html.ts            report page blocks + clipboard copy
    docx.ts            .docx export and the figures zip
  pwa.ts               service worker registration, update check, install prompt (§6.3)
  pwa-none.ts          stand-in for the registration in the offline file
  tools/
    plot.ts            line/step plots with labelled axes
    profile.ts  boxstats.ts  histogram.ts  starprofile.ts  distance.ts
  tasks/
    index.ts           task definitions, answer checking
    context.ts         values computed from the student's data (MeasureContext)
  i18n/
    index.ts           t(), language switch, number formatting
    et.ts  en.ts       interface strings
    glossary.ts
  content/
    index.ts           loads and renders the Markdown files
    et/steps/*.md  en/steps/*.md    explanations ("Miks?" + "Uuri lähemalt")
    et/tasks/*.md  en/tasks/*.md    task texts and hints
  ui/
    files.ts  profile.ts  calibrate.ts  align.ts  color.ts  resume.ts  glossary.ts  settings.ts
    viewerpanel.ts     viewer with toolbar, readout and tool tabs
    compare.ts         "Võrdle" tab: blink/split, versions list
    report.ts          report page: sections, items, captions, downloads, print
    about.ts           About page: version, offline status, install, updates, offline file
    comments.ts        mentor comments on steps and tasks
    header.ts          FITS header viewer
    explain.ts         "Miks?" / "Uuri lähemalt" panel
    task.ts            task with answer fields and hint levels
    projectbar.ts      new / open / save, Ctrl+S, unsaved-changes warning
    checks.ts          list of check results
test/                  Vitest tests with synthetic FITS files (helpers.ts)
docs/
  DESIGN.md            this document
public/                favicon and app icons
.github/workflows/     pages.yml (GitHub Pages), release.yml (offline file on a version tag)
```

---

## 7. Milestones

Every milestone includes Estonian and English texts for its own features.

1. **Viewer**: FITS reader (incl. `.fits.gz`), instrument profiles with header aliases and the reference profile, file table with sorting, zip import, ET/EN switch, viewer with pixel readout, profile, box statistics, histogram and header viewer.
2. **Trim and master frames**, with explanations and the first tasks with hints. Consistency checks.
3. **Calibration**, the project file, and the "Kus ma pooleli jäin" page.
4. **Alignment and stacking**: stars clicked by hand, then the automatic check. Shift first, then rotation and meridian flip.
5. **Colour** and image export.
6. **Versions and comparison**, mentor mode and comments.
7. **Report**: "Lisa aruandesse" buttons, report page, `.docx` export, copying by section and by image, figures zip. Tested by pasting into Google Docs and Word.
8. **Publishing and offline use**: GitHub Pages, service worker and install, update prompt, the offline HTML file as a release attachment. (The rule "nothing loaded from other servers" applies from milestone 1.)
9. **More instruments**: profile editor page, profile import/export, software binning on import, `.fz` support if needed. Tested with a second dataset.

---

## 8. Open questions

- **Offline use in other browsers.** Storing the app, opening it with the server stopped, the update message and the offline file from `file://` were tested in headless Chrome. Installing, and offline use in Safari and Firefox, still have to be tried by hand once the app is on GitHub Pages.
- **Pasting the report.** The `.docx` opens in macOS Quick Look and `textutil`; it still has to be opened in Word and Google Docs, and the copied sections and images pasted into both, by hand.
- **Test data in development.** Tests and local development use `data/`, which is not in the repository. Automated tests that need FITS files should use small synthetic files generated by the test code, so the repository stays free of data.
- **Distance of M57** for task 13: the value given in the task text (about 790 pc / 2600 ly from Gaia) should be checked before use.
- **Who writes the content?** Draft explanations and tasks can be written in Estonian and English, with the mentor reviewing the Estonian text.
- **Other datasets.** Which telescopes and cameras are likely next? A few sample files from each (one bias, dark, flat and light) are enough to build and test their profiles, and to check the header aliases.
- **Colour cameras.** Debayering is a non-goal for now. If a future telescope has a one-shot colour camera, this has to be reconsidered.
