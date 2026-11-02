CCD-kaamera loeb pildi välja rida-realt. Paljud kaamerad lisavad igale reale ka mõne **ülelugemisala** veeru: need loetakse välja nagu tavalised pikslid, kuid need ei saa valgust. Mõnel kaameral on samasugused veerud ka rea alguses.

Need veerud on kasulikud kaamera kontrollimiseks, kuid pildis segavad: tasaväljakaadris on seal peaaegu null, ja kui hiljem objektikaadrit tasaväljakaadriga jagada, tuleks jagamine peaaegu nulliga. Seepärast lõigatakse need **enne kõike muud** ära.

Kuidas need veerud leida? Tasaväljakaadris on valgust saav ala hele (kümneid tuhandeid ADU), valguseta veerud aga eelpinge tasemel (umbes tuhat ADU). **Rea profiil** näitab seda järsu astmena.

Kui astet pole, saavad kõik veerud valgust ja kärpimist pole vaja.

<!-- more -->

**Miks ülelugemisala üldse olemas on?** Kaamera lisab igale pikslile enne digiteerimist kindla pinge – **eelpinge**. Siis ei lähe müra tõttu ükski väärtus alla nulli. Eelpinge võib aga pildi tegemise ajal veidi triivida. Ülelugemisala veerud näitavad eelpinget sama rea lugemise ajal, nii et seda saab iga rea jaoks eraldi arvesse võtta. Selles rakenduses kasutame selle asemel koondeelpingekaadrit, mis on lihtsam ja meie andmete jaoks piisav.

**Osaliselt valgustatud veerud.** Astme servas võib olla üks-kaks veergu, mis saavad ainult osa valgusest. Ka need on parem ära lõigata.
