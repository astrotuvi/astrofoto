The camera is monochrome: each pixel measures only how much light reached it, not the colour of the light. For a colour image, the same object is photographed through several filters. Each filter lets through only part of the spectrum.

A screen makes all colours from three primary colours: red, green and blue. Putting the images of three filters into the three **channels** gives a colour image:
- the filter with the shortest wavelength (e.g. B or g) → blue channel;
- the middle one (V or r) → green channel;
- the longest one (R or i) → red channel.

The brightness of each channel is computed as

```
brightness = weight × (value − black point) / (white point − black point)
```

The result runs from 0 (black) to 1 (fully bright). Anything outside that range is cut off.

The **black point** has to be at the sky background, otherwise the sky is grey or coloured. The **weight** changes the colour balance: if the sky has a colour, that channel is stronger than the others.

The sky and a faint nebula are much darker than the stars. On a linear scale the faint parts stay almost black. A **stretch** (asinh) makes the faint parts brighter and squeezes the bright parts together.

<!-- more -->

**The asinh stretch.** The stretched brightness is computed as (t is the strength):

```
stretched = asinh(t × brightness) / asinh(t)
```

For small numbers asinh(x) ≈ x, so the faint parts become about t / asinh(t) times brighter. For large numbers asinh grows slowly, like a logarithm, so bright stars do not burn out to white. Large sky surveys, such as SDSS, make their colour images with the same function.

**Are the colours "right"?** The three kinds of colour-sensitive cells in the eye are not the same as astronomical filters. B, V, R and g, r, i let through slightly different wavelengths, so BVR and gri images differ a little. Neither is exactly what the eye would see, but the order of the star colours, from bluish to reddish, stays the same.

**False colour.** Narrowband filters (Hα, [O III], [S II]) let through the light of a single gas only. They are often put into the channels by convention, so that the gases can be told apart. In the Hubble palette, for example, [S II] is red, Hα green and [O III] blue.

**A coloured edge on one side of the stars** means that the channels do not line up: the image of one filter is shifted relative to another. This is a good check of the alignment.
