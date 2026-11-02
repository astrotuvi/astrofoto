Ka siis, kui kaamera teeb nullise säriajaga pildi, pole pikslite väärtus null. Kaamera lisab igale pikslile kindla taseme, **eelpinge**, ja lugemisel tekib lisaks **lugemismüra**. Sellist kaadrit nimetatakse **eelpingekaadriks** (bias-kaader).

Eelpinge on igas kaadris peaaegu sama, kuid igal pikslil võib olla veidi oma tase. Selle eemaldamiseks tehakse mitu eelpingekaadrit ja arvutatakse neist **koondeelpingekaader**: iga piksli jaoks võetakse kõigi kaadrite mediaan või keskmine.

```
koondeelpingekaader = mediaan(eelpingekaader₁, eelpingekaader₂, …, eelpingekaaderₙ)
```

Miks mitu kaadrit? Iga kaader on mürane. Kui N kaadrit keskmistada, väheneb juhuslik müra ligikaudu √N korda. Nii ei lisa koondkaader hiljem objektikaadritele peaaegu uut müra.

Kui eelpinget ei lahutata, jääb igale pikslile ligi poolteist tuhat ADU lisaks – pilt on „hall“ ja tasaväljakaadriga jagamine annab vale tulemuse.

<!-- more -->

**Keskmine või mediaan?** Keskmine vähendab müra kõige rohkem: N kaadri korral √N korda. Mediaan vähendab seda veidi vähem – suure N korral umbes √(π/2) ≈ 1,25 korda vähem kui keskmine. Mediaani eelis on, et üksikud väga suured väärtused (näiteks kosmiliste kiirte jäljed) ei mõjuta tulemust peaaegu üldse.

**Sigma-lõikega keskmine** ühendab mõlema head küljed: iga piksli jaoks arvutatakse mediaan ja standardhälve, visatakse välja väärtused, mis on mediaanist kaugemal kui 3 standardhälvet, ja ülejäänutest võetakse keskmine.

**Miks √N?** Kui liita N sõltumatut juhuslikku viga, kasvab summa viga ainult √N korda, mitte N korda – vead tasakaalustavad osaliselt üksteist. Keskmine on summa jagatud N-ga, seega selle viga on √N / N = 1/√N korda üksikkaadri oma.
