Even when the camera takes an image with zero exposure, the pixel values are not zero. The camera adds a fixed level to every pixel, the **bias**, and reading out adds **read noise**. Such a frame is called a **bias frame**.

The bias is almost the same in every frame, but each pixel may have a slightly different level. To remove it, several bias frames are taken and a **master bias** is computed from them: for each pixel, the median or mean of all frames.

```
master bias = median(bias₁, bias₂, …, biasₙ)
```

Why several frames? Each frame is noisy. When N frames are averaged, the random noise drops by about √N. That way the master adds almost no new noise to the light frames later.

If the bias is not subtracted, about one and a half thousand ADU stays on every pixel – the image looks "grey", and dividing by the flat gives a wrong result.

<!-- more -->

**Mean or median?** The mean reduces the noise the most: by √N for N frames. The median reduces it slightly less – for large N about √(π/2) ≈ 1.25 times less than the mean. The advantage of the median is that single very large values (such as cosmic-ray hits) hardly affect the result at all.

The **sigma-clipped mean** combines the strengths of both: for each pixel the median and standard deviation are computed, values further than 3 standard deviations from the median are thrown out, and the rest are averaged.

**Why √N?** When N independent random errors are added, the error of the sum grows only √N times, not N times – the errors partly cancel out. The mean is the sum divided by N, so its error is √N / N = 1/√N times that of a single frame.
