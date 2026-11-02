Teleskoop ei valgusta sensorit päris ühtlaselt. Pildi servad on sageli tumedamad (**vinjeteerimine**), tolmukübemed optikal jätavad tumedaid rõngaid ja igal pikslil on veidi erinev tundlikkus.

**Tasaväljakaader** tehakse ühtlaselt valgustatud allikast – näiteks hämaruses taevast. See näitab, kui palju valgust iga piksel tegelikult saab. Hiljem jagatakse iga objektikaader koondtasaväljakaadriga, nii et tumedamad kohad muutuvad sama heledaks kui ülejäänud pilt.

Iga filtri jaoks tehakse **eraldi** koondtasaväljakaader, sest tolm ja tundlikkus sõltuvad lainepikkusest. Igast kaadrist:

1. lahutatakse koondeelpingekaader;
2. kaader jagatakse oma mediaaniga, nii et selle väärtused on 1 ümber (**normeerimine**);
3. normeeritud kaadrite mediaan on koondtasaväljakaader.

```
normeeritud kaader = (tasaväljakaader − koondeelpingekaader) / mediaan
```

Normeerimine on vajalik, sest hämaruses taevas tumeneb kiiresti ja iga tasaväljakaader on erineva heledusega.

<!-- more -->

**Miks jagamine, mitte lahutamine?** Kui piksel saab vinjeteerimise tõttu ainult 90 % valgusest, on selle väärtus 90 % õigest – nii tähel kui taustal. Viga on suhteline, seepärast parandatakse see jagamisega: 90 / 0,9 = 100.

**Taeva tasaväljakaadrid** tehakse vahetult pärast päikeseloojangut, kui taevas on piisavalt tume, et kaamera ei küllastu, aga tähti veel ei paista. Taeva heledus muutub kiiresti, seepärast pikendab vaatlusprogramm säriaega. Taevas pole ka päris ühtlane – päikeseloojangu poolne külg on heledam, mis võib tekitada tasaväljakaadrisse kerge kalde.
