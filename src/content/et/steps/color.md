Kaamera on ühevärviline: iga piksel mõõdab ainult seda, kui palju valgust sinna jõudis, mitte valguse värvi. Värvipildi jaoks pildistatakse sama objekti läbi mitme filtri. Iga filter laseb läbi ainult osa spektrist.

Ekraan teeb kõik värvid kolmest põhivärvist: punasest, rohelisest ja sinisest. Kui panna kolme filtri pildid kolme **kanalisse**, saame värvipildi:
- lühima lainepikkusega filter (näiteks B või g) → sinine kanal;
- keskmine (V või r) → roheline kanal;
- pikim (R või i) → punane kanal.

Iga kanali heledus arvutatakse nii:

```
heledus = kaal × (väärtus − must punkt) / (valge punkt − must punkt)
```

Tulemus on 0 (must) kuni 1 (täiesti hele). Mis jääb sellest välja, lõigatakse ära.

**Must punkt** peab olema taeva tausta juures, muidu on taevas hall või värviline. **Kaal** muudab värvide tasakaalu: kui taevas on mingit värvi, on see kanal teistest tugevam.

Taevas ja nõrk udukogu on palju tumedamad kui tähed. Lineaarsel skaalal jäävad nõrgad osad peaaegu mustaks. **Venitus** (asinh) teeb nõrgad osad heledamaks ja surub heledad osad kokku.

<!-- more -->

**asinh-venitus.** Venitatud heledus arvutatakse nii (t on tugevus):

```
venitatud = asinh(t × heledus) / asinh(t)
```

Väikeste arvude korral on asinh(x) ≈ x, nii et nõrgad osad muutuvad umbes t / asinh(t) korda heledamaks. Suurte arvude korral kasvab asinh aeglaselt, nagu logaritm, ja heledad tähed ei põle valgeks. Sama funktsiooniga tehakse värvipilte ka suurtes taevaülevaadetes, näiteks SDSS-is.

**Kas värvid on „õiged“?** Silma kolm värvitundlikku rakuliiki ei ole samad mis astronoomilised filtrid. B, V, R ja g, r, i lasevad läbi veidi eri lainepikkusi, seepärast on BVR- ja gri-pildid veidi erinevad. Kumbki ei ole täpselt see, mida näeks silm, aga tähtede värvide järjekord sinakast punakani jääb samaks.

**Vale värv.** Kitsasribafiltrid (Hα, [O III], [S II]) lasevad läbi ainult ühe gaasi kiirguse. Need pannakse kanalitesse sageli kokkuleppe järgi, et eri gaasid oleksid eristatavad. Näiteks Hubble'i paletis on [S II] punane, Hα roheline ja [O III] sinine.

**Värviline äär tähtede ühel küljel** tähendab, et kanalid ei kattu: ühe filtri pilt on teise suhtes nihkes. See on hea kontroll joondusele.
