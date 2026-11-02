# Tasaväljakaadri ühtlus

Ava filtri **{filter}** normeeritud koondtasaväljakaader. Mõõda kasti statistikaga **mediaan** kaadri keskel ja kõigis neljas nurgas (umbes 30 × 30 piksli suurused alad).

Mitu protsenti on kõige tumedam nurk keskkohast tumedam? Kas tumedam on üks külg või kõik servad?

<!-- hint -->
Normeeritud kaadri väärtused on 1 ümber. Väärtus 0,95 tähendab, et see piksel saab 5 % vähem valgust kui keskmine piksel.

<!-- hint -->
```
erinevus (%) = (1 − nurk / kese) × 100
```

<!-- hint -->
Näiteks kui keskel on 1,05 ja tumedaimas nurgas 0,98, on erinevus (1 − 0,98 / 1,05) × 100 ≈ 6,7 %. AZT-12 andmestikus on üks pildi pool heledam kui teine – see ei ole tavaline vinjeteerimine (mis teeks kõik servad tumedaks), vaid kalle. Mis võiks seda põhjustada? Mõtle, kuidas taeva tasaväljakaadrid tehakse.
