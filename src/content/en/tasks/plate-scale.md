# Pixel scale and field of view

How many arcseconds of sky fit on one pixel? How wide is the whole image in arcminutes?

You need two keywords from the header: the telescope's focal length and the pixel size.

<!-- hint -->
Look for `FOCALLEN` (in millimetres) and `XPIXSZ` (in micrometres) in the header. Check whether `XPIXSZ` is the size of the binned pixel – see its explanation.

<!-- hint -->
A small angle in radians is the pixel size divided by the focal length (in the same units). One radian has 206 265 arcseconds. The width of the field is the pixel scale times the number of pixels in a row.

<!-- hint -->
For the AZT-12 data:

```
pixel scale = 206 265″ × pixel size / focal length
            = 206 265″ × 0.026 mm / 12 000 mm ≈ 0.45″ per pixel
```

The trimmed image is 512 pixels wide, so the field of view is 512 × 0.45″ ≈ 229″ ≈ 3.8′. (The untrimmed 524 pixels give 3.9′ – that is accepted too.)
