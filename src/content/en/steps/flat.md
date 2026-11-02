A telescope does not light the sensor quite evenly. The edges of the image are often darker (**vignetting**), dust specks on the optics leave dark rings, and each pixel has a slightly different sensitivity.

A **flat frame** is taken of an evenly lit source – for example the twilight sky. It shows how much light each pixel really gets. Later each light frame is divided by the master flat, so the darker places become as bright as the rest of the image.

A **separate** master flat is made for each filter, because dust and sensitivity depend on the wavelength. From each frame:

1. the master bias is subtracted;
2. the frame is divided by its own median, so its values are around 1 (**normalising**);
3. the median of the normalised frames is the master flat.

```
normalised frame = (flat − master bias) / median
```

Normalising is needed because the twilight sky darkens quickly and each flat has a different brightness.

<!-- more -->

**Why divide, not subtract?** If a pixel gets only 90% of the light because of vignetting, its value is 90% of the right one – both for a star and for the background. The error is relative, so it is corrected by dividing: 90 / 0.9 = 100.

**Sky flats** are taken right after sunset, when the sky is dark enough that the camera does not saturate, but no stars show yet. The sky brightness changes quickly, so the observing program lengthens the exposure. The sky is not perfectly even either – the side towards the sunset is brighter, which can put a slight slope into the flat.
