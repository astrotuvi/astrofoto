# Cosmic ray

Find a **cosmic-ray hit** in one aligned frame: a very bright dot or short streak that is sharper than the stars and is in that one frame only. Look at the same place in the stacked image – stack once with the median and once with the mean.

Which stacking method removes the hit, and why?

<!-- hint -->
Switch between the aligned frames of the same filter in the image picker: a dot that is in one frame only stands out. Zoom in and look at the profile: a cosmic-ray hit is 1–3 pixels wide, a star much wider.

<!-- hint -->
Think about what happens to one pixel in three frames when one has the value 5000 ADU and the other two 1000 ADU. What is the mean of these three numbers? What is the median?

<!-- hint -->
The mean is (1000 + 1000 + 5000) / 3 ≈ 2333 ADU – the hit stays in, only fainter. The median is 1000 ADU, because in the sorted row 1000, 1000, 5000 the middle value is 1000 – the hit disappears completely. The median does not depend on one value that is very different, which is why it removes defects that are in one frame only.
