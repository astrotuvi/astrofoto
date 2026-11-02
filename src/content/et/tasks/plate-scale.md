# Pikslimõõt ja vaateväli

Mitu kaaresekundit taevast mahub ühele pikslile? Kui lai on kogu pilt kaareminutites?

Vaja on päisest kahte võtmesõna: teleskoobi fookuskaugust ja piksli suurust.

<!-- hint -->
Otsi päisest `FOCALLEN` (millimeetrites) ja `XPIXSZ` (mikromeetrites). Kontrolli, kas `XPIXSZ` on kokkuliidetud (binning) piksli suurus – vaata selle selgitust.

<!-- hint -->
Väike nurk radiaanides on piksli suurus jagatud fookuskaugusega (samades ühikutes). Ühes radiaanis on 206 265 kaaresekundit. Vaatevälja laius on pikslimõõt korda pikslite arv reas.

<!-- hint -->
AZT-12 andmete jaoks:

```
pikslimõõt = 206 265″ × piksli suurus / fookuskaugus
           = 206 265″ × 0,026 mm / 12 000 mm ≈ 0,45″ pikslis
```

Kärbitud pilt on 512 pikslit lai, seega vaateväli on 512 × 0,45″ ≈ 229″ ≈ 3,8′. (Kärpimata 524 pikslit annab 3,9′ – ka see sobib.)
