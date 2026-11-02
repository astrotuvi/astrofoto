Even in the dark, signal builds up in the sensor's pixels, because heat frees electrons. This is called **dark current**. The longer the exposure and the warmer the sensor, the more signal.

A **dark frame** is taken with the shutter closed, with the same exposure and temperature as the light frames. The master bias is subtracted from it – only the heat signal remains. The median of several darks is the **master dark**:

```
master dark = median(dark₁ − master bias, …, darkₙ − master bias)
```

If the dark was taken with a different exposure, it is multiplied by t_light / t_dark during calibration, because dark current grows in proportion to the exposure.

In a strongly cooled camera the dark current is very small. Some pixels are **hot**, though: they build up much more signal than the others. The dark frame removes these too.

<!-- more -->

**Dark current and temperature.** Dark current roughly doubles for every 6–7 °C of warming. That is why astronomical cameras are cooled – this camera's sensor worked at −60 °C.

**Cosmic rays.** In a single dark you may see bright dots or streaks that are somewhere else in the next frame. They are tracks of cosmic rays and radioactivity. The median removes them, because in each pixel the track is in only one frame.
