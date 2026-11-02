# Sky background before and after

Measure the median of the sky background in **{file}** with box statistics – choose an area with no stars. Measure the same place in the raw frame and in the calibrated frame. By how much did the background drop in calibration?

<!-- hint -->
First choose the raw frame in the image picker (under light frames), then the same frame under "Calibrated light frames". The calibrated frame is trimmed, so choose the box again.

<!-- hint -->
Think about what was subtracted during calibration. Do you know their sizes from earlier tasks?

<!-- hint -->
The background dropped by about the bias level (≈ 1454 ADU in the AZT-12 data) plus the dark current (≈ 4 ADU). Dividing by the flat changes the value by a few more per cent, depending on whether the area is in a bright or a dark part of the flat.
