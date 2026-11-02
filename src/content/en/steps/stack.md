A single frame has a lot of noise: the sky background and faint stars look grainy. When several aligned frames are stacked, the signal (stars, nebula) is the same in every frame, but the noise is different in each frame and partly cancels out.

In the average of N frames, the noise is about √N times smaller than in one frame:

```
noise(stacked) ≈ noise(one frame) / √N
```

Stacking also removes **random defects**: cosmic-ray hits and satellites that are in one frame only.

The stacking method is the same choice as for master frames:
- **median** leaves out values that differ a lot from the others in one frame;
- **mean** gives the lowest noise, but every bright hit stays in, only fainter.

The frames of each filter are stacked separately. Later the filter images are combined into a colour image.

<!-- more -->

**Why √N?** Noise is random: in each frame it is sometimes positive, sometimes negative. When N frames are added, the signal grows N times, but random noise only √N times (like a random walk). In the average both are divided by N, so the signal-to-noise ratio improves √N times.

**The price of the median.** The median is slightly noisier than the mean: about 1.25 times for many frames. With three frames it is still the better choice, because one cosmic ray would spoil the mean.

**Sigma clipping.** With many frames (at least 5) you can use a mean that first leaves out values too far from the median (e.g. more than 3 standard deviations). This combines the advantages of both: low noise like the mean, and removal of defects like the median.
