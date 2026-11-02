# Noise of the master

The master bias is made of {n} frames. **Predict before computing it** how large the noise (standard deviation) of the master will be. Then compute the master and measure its noise in the same place as in the previous task.

Does the measured noise match your prediction? Does the result depend on whether you chose the median or the mean?

<!-- hint -->
Read in the "Why?" panel how many times the noise drops when N frames are averaged.

<!-- hint -->
Random noise drops by √N. Divide the single-frame standard deviation by √{n}.

<!-- hint -->
For example in the AZT-12 data: if the single-frame noise is about 6 ADU and there are 25 frames, the prediction is 6 / √25 = 6 / 5 = 1.2 ADU. In a master made with the mean you measure about 1.2 ADU. With the median you measure about 1.5 ADU, because the median reduces noise about 1.25 times less than the mean (see "Find out more"). Try both methods!
