# Evenness of the flat

Open the normalised master flat of the **{filter}** filter. With box statistics, measure the **median** in the middle of the frame and in all four corners (areas of about 30 × 30 pixels).

By how many per cent is the darkest corner darker than the centre? Is one side darker, or all the edges?

<!-- hint -->
The values of a normalised frame are around 1. A value of 0.95 means this pixel gets 5% less light than the average pixel.

<!-- hint -->
```
difference (%) = (1 − corner / centre) × 100
```

<!-- hint -->
For example, if the centre is 1.05 and the darkest corner 0.98, the difference is (1 − 0.98 / 1.05) × 100 ≈ 6.7%. In the AZT-12 dataset one half of the image is brighter than the other – this is not ordinary vignetting (which would make all edges dark) but a slope. What could cause it? Think about how sky flats are taken.
