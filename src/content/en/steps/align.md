During and between exposures the telescope moves slightly relative to the sky: tracking is not perfect, wind shakes the telescope, the mount settles. So a star is not in exactly the same pixel in every frame.

If such frames were stacked straight away, the stars would become wider or doubled. Before stacking, the frames must be **aligned**: each frame is moved so that the stars land in the same places as in the **reference frame**.

One star is enough to find the shift: if a star is at (x₀, y₀) in the reference frame and at (x, y) in another frame, then

```
Δx = x₀ − x,   Δy = y₀ − y
```

For a more precise result, the shifts of several stars are averaged. The position of a star is found as a weighted average: the coordinates of each pixel are weighted by its brightness (after subtracting the sky background). This finds the centre of a star to a fraction of a pixel.

If the frames are also **rotated**, at least two stars are needed: the line between two stars shows how much the frame has turned.

<!-- more -->

**How do you move an image by half a pixel?** Each pixel of the new frame is computed from the four nearest pixels of the old frame, weighted by distance (**bilinear interpolation**). This smooths the image slightly but keeps its brightness.

**Meridian flip.** On an equatorial mount, the telescope must swing to the other side of the mount when the object crosses the meridian. After that, the image is rotated by 180°. The app tries this automatically when the stars do not match without rotation.

**Automatic alignment.** The app finds the bright stars in each frame. Bright knots of a nebula are left out: a star must stand out clearly from its surroundings. Then each star is matched with the nearest star in the reference frame. If that fails, **triangles** of the brightest stars are compared – the ratios of a triangle's sides do not change when it is shifted or rotated. Finally the shift and rotation are fitted by **least squares**: so that the sum of the squared distances between the stars is as small as possible.
