Ühes kaadris on palju müra: taeva taust ja nõrgad tähed on täpilised. Kui liita mitu joondatud kaadrit, siis signaal (tähed, udukogu) on igas kaadris sama, aga müra on igas kaadris erinev ja osaliselt kustutab ennast.

N kaadri keskmises on müra umbes √N korda väiksem kui ühes kaadris:

```
müra(liidetud) ≈ müra(üks kaader) / √N
```

Liitmisel kaovad ka **juhuslikud vead**: kosmiliste kiirte jäljed ja satelliidid, mis on ainult ühes kaadris.

Liitmise viis on sama valik nagu koondkaadrite puhul:
- **mediaan** jätab välja väärtused, mis on ühes kaadris teistest väga erinevad;
- **keskmine** annab kõige väiksema müra, aga iga hele jälg jääb alles, lihtsalt nõrgemana.

Liidetakse iga filtri kaadrid eraldi. Hiljem pannakse filtrite pildid kokku värvipildiks.

<!-- more -->

**Miks just √N?** Müra on juhuslik: igas kaadris on see kord positiivne, kord negatiivne. Kui liita N kaadrit, kasvab signaal N korda, aga juhuslik müra ainult √N korda (nagu juhuslik ekslemine). Keskmises jagatakse mõlemad N-iga, seega signaali ja müra suhe paraneb √N korda.

**Mediaani hind.** Mediaan on veidi mürarikkam kui keskmine: suure kaadrite arvu korral umbes 1,25 korda. Kolme kaadri puhul on see siiski parem valik, sest üks kosmiline kiir rikuks keskmise ära.

**Sigma-lõige.** Kui kaadreid on palju (vähemalt 5), saab kasutada keskmist, kust on eelnevalt välja jäetud väärtused, mis on mediaanist liiga kaugel (näiteks üle 3 standardhälbe). See ühendab mõlema eelised: väike müra nagu keskmisel ja vigade eemaldamine nagu mediaanil.
