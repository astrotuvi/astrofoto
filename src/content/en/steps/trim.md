A CCD camera reads out the image row by row. Many cameras add a few **overscan** columns to each row: they are read out like normal pixels, but they get no light. Some cameras have similar columns at the start of the row as well.

These columns are useful for checking the camera, but they get in the way in the image: in a flat frame they are almost zero, and when a light frame is later divided by the flat, it would be divided by almost zero. That is why they are cut off **before anything else**.

How do you find these columns? In a flat frame the area that gets light is bright (tens of thousands of ADU), while the columns without light stay at the bias level (about a thousand ADU). A **row profile** shows this as a sharp step.

If there is no step, every column gets light and no trimming is needed.

<!-- more -->

**Why does overscan exist at all?** Before digitising, the camera adds a fixed voltage to every pixel – the **bias**. Then no value drops below zero because of noise. The bias can drift slightly while the image is taken, though. The overscan columns show the bias during the readout of the same row, so it can be taken into account row by row. In this app we use a master bias instead, which is simpler and good enough for our data.

**Partly lit columns.** At the edge of the step there may be one or two columns that get only part of the light. It is better to cut those off too.
