# Columns that get light

Find from a flat's row profile **the first and the last column that gets the full light**.

<!-- hint -->
On the profile tab, click in the middle of the flat. The plot shows where the value rises and drops sharply. Zoom into the image to see single columns and move the mouse over them – the column number and value appear below.

<!-- hint -->
Columns without light are at the bias level (about 1500 ADU), columns with light at tens of thousands. At the edge of the step there may be a column that gets only part of the light – do not count it.

<!-- hint -->
In the AZT-12 Andor camera the columns without light are 1–4 and 517–524 (columns 4 and 517 get part of the light). Columns **5–516** get the full light, 512 columns in all. The camera reads out more pixels in each row than the sensor has light-sensitive pixels: the extra columns are used to measure the bias and the read noise.
