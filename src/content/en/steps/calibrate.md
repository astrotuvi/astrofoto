Now all master frames are ready and they can be used to correct the light frames. From each light frame:

1. the master bias is subtracted – the level added by the camera goes away;
2. the master dark is subtracted – the heat signal and hot pixels go away;
3. the result is divided by the master flat of the same filter – vignetting and dust disappear.

```
calibrated = (light − master bias − master dark) / master flat
```

Because the master flat is normalised (values around 1), the brightness of the image stays the same after dividing.

After calibration each pixel holds only **light that came from the sky**: the sky background, the stars and the nebula.

Each part can be switched off. Try what happens when a step is left out!

<!-- more -->

**Scaling the dark.** If the dark was taken with a different exposure from the light, the master dark is multiplied by t_light / t_dark before subtracting. This only works when the bias has already been subtracted from the dark – otherwise the bias would be scaled too, and the bias does not depend on the exposure.

**Why in this order?** Bias and dark current add to the light (so they are subtracted), while the flat multiplies the light (so the image is divided by it). Dividing before subtracting would also divide the bias, which does not depend on the optics – and the result would be wrong.
