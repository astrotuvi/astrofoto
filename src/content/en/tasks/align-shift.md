# How far did the stars move?

Find the centre of the same bright star in the first frame (**{first}**) and in the last frame (**{last}**). How large is the shift between these frames in pixels and in arcseconds? What could have caused it?

<!-- hint -->
Look at the alignment table: it shows the shift of each frame relative to the reference frame. If the reference frame is not the first frame, take the difference between the shifts of the first and the last frame.

<!-- hint -->
If the shift is Δx and Δy, the total shift is √(Δx² + Δy²) by Pythagoras' theorem. To convert it to arcseconds, multiply by the pixel scale (″/px) that you found in the files step.

<!-- hint -->
In the AZT-12 data, the last frame (R) is shifted relative to the first by about 2.0 pixels in x and 1.2 pixels in y: in total √(2.0² + 1.2²) ≈ 2.3 pixels, or 2.3 × 0.45 ≈ 1.0″. In between the shift was even larger – up to about 4 pixels in the V frames – and then smaller again. So the image did not drift steadily in one direction but wandered back and forth. This points to tracking errors of the telescope: the gears of the drive are not perfect (periodic error) and the polar axis is not pointed quite exactly.
