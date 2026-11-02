Säriaja jooksul ja kaadrite vahel nihkub teleskoop taeva suhtes veidi: jälgimine pole täiuslik, tuul raputab teleskoopi, statiiv vajub. Seepärast pole täht igas kaadris täpselt samas pikslis.

Kui sellised kaadrid kohe kokku liita, muutuvad tähed laiemaks või kahekordseks. Enne liitmist tuleb kaadrid **joondada**: iga kaader nihutatakse nii, et tähed satuvad samadesse kohtadesse kui **võrdluskaadris**.

Nihke leidmiseks piisab ühest tähest: kui täht on võrdluskaadris kohas (x₀, y₀) ja teises kaadris kohas (x, y), siis

```
Δx = x₀ − x,   Δy = y₀ − y
```

Täpsemaks tulemuseks arvutatakse mitme tähe nihete keskmine. Tähe asukoht leitakse kaalutud keskmisena: iga piksli koordinaate kaalutakse tema heledusega (pärast taeva tausta lahutamist). Nii saab tähe keskme leida murdosa piksli täpsusega.

Kui kaadrid on ka **pööratud**, on vaja vähemalt kahte tähte: kahe tähe vaheline joon näitab, kui palju kaader on pöördunud.

<!-- more -->

**Kuidas nihutatakse pool pikslit?** Uue kaadri iga piksli väärtus arvutatakse vana kaadri nelja lähima piksli põhjal, kaaludes neid kauguse järgi (**bilineaarne interpolatsioon**). See silub pilti veidi, aga säilitab heleduse.

**Meridiaanipööre.** Ekvatoriaalmontaažil teleskoop peab objekti jälgimisel meridiaani ületades teisele poole montaaži pöörama. Pärast seda on pilt 180° pööratud. Rakendus proovib seda automaatselt, kui tähed ilma pööramata ei klapi.

**Automaatne joondamine.** Rakendus otsib igast kaadrist heledad tähed. Udukogu heledad sõlmed jäetakse välja: täht peab paistma oma ümbrusest selgelt heledam. Siis otsitakse igale tähele lähim täht võrdluskaadris. Kui see ei õnnestu, võrreldakse heledamate tähtede **kolmnurki** – kolmnurga külgede suhted ei muutu nihutamisel ega pööramisel. Lõpuks arvutatakse nihe ja pööre **vähimruutude meetodiga**: nii, et tähtede kauguste ruutude summa oleks võimalikult väike.
