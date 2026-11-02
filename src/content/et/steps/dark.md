Ka pimedas tekib sensori pikslitesse signaali, sest soojuse tõttu vabaneb elektrone. Seda nimetatakse **pimevooluks**. Mida pikem säriaeg ja mida soojem sensor, seda rohkem signaali.

**Pimekaader** tehakse suletud katikuga, sama säriaja ja temperatuuriga nagu objektikaadrid. Sellest lahutatakse koondeelpingekaader – alles jääb ainult soojuse signaal. Mitme pimekaadri mediaan on **koondpimekaader**:

```
koondpimekaader = mediaan(pimekaader₁ − koondeelpingekaader, …, pimekaaderₙ − koondeelpingekaader)
```

Kui pimekaader on tehtud teise säriajaga, korrutatakse see kalibreerimisel suhtega t_objekt / t_pime, sest pimevool kasvab säriajaga võrdeliselt.

Tugevalt jahutatud kaameras on pimevool väga väike. Mõned pikslid on aga **kuumad**: neis tekib palju rohkem signaali kui teistes. Pimekaader eemaldab ka need.

<!-- more -->

**Pimevool ja temperatuur.** Pimevool kahekordistub umbes iga 6–7 °C soojenemisega. Seepärast jahutatakse astronoomilisi kaameraid – selle kaamera sensor töötas −60 °C juures.

**Kosmilised kiired.** Üksikus pimekaadris võid näha heledaid punkte või kriipse, mis järgmises kaadris on mujal. Need on kosmiliste kiirte ja radioaktiivsuse jäljed. Mediaan eemaldab need, sest igas pikslis on jälg ainult ühes kaadris.
