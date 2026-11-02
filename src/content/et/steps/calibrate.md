Nüüd on kõik koondkaadrid valmis ja neid saab kasutada objektikaadrite parandamiseks. Igast objektikaadrist:

1. lahutatakse koondeelpingekaader – eemaldub kaamera lisatud tase;
2. lahutatakse koondpimekaader – eemaldub soojuse signaal ja kuumad pikslid;
3. tulemus jagatakse sama filtri koondtasaväljakaadriga – vinjeteerimine ja tolm kaovad.

```
kalibreeritud = (objektikaader − koondeelpingekaader − koondpimekaader) / koondtasaväljakaader
```

Kuna koondtasaväljakaader on normeeritud (väärtused 1 ümber), jääb pildi heledus pärast jagamist samaks.

Pärast kalibreerimist on igas pikslis ainult **taevast tulnud valgus**: taeva taust, tähed ja udukogu.

Iga osa saab välja lülitada. Proovi, mis juhtub, kui mõni samm vahele jätta!

<!-- more -->

**Pimekaadri skaleerimine.** Kui pimekaader tehti teise säriajaga kui objektikaader, korrutatakse koondpimekaader enne lahutamist suhtega t_objekt / t_pime. See töötab ainult siis, kui eelpinge on pimekaadrist juba lahutatud – muidu skaleeritaks ka eelpinget, mis säriajast ei sõltu.

**Miks just selles järjekorras?** Eelpinge ja pimevool liituvad valgusele (neid lahutatakse), tasaväli aga korrutab valgust (sellega jagatakse). Kui jagada enne lahutamist, jagataks ka eelpinget, mis optikast ei sõltu – ja tulemus oleks vale.
