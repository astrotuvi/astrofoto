# Dark current

Compute the master dark and measure its mean over a large area. How many ADU per second build up in a pixel because of heat?

Is a dark frame needed at all for this camera? What else does it fix?

<!-- hint -->
The bias is already subtracted in the master dark – only the heat signal is left. Choose as large an area as possible, but avoid single bright pixels.

<!-- hint -->
Dark current = mean of the master dark / exposure time of the dark.

<!-- hint -->
In the AZT-12 data the mean of the master dark is about 4 ADU per 30 seconds, so the dark current is about 4 / 30 ≈ 0.13 ADU/s. This is very small compared to the sky background (hundreds of ADU). The dark frame is still useful, because it removes **hot pixels** – single pixels where much more signal builds up than in the others.
