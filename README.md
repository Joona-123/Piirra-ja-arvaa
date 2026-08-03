# ✏️ Piirrä ja arvaa

Selainpohjainen piirustus- ja arvauspeli suomeksi, luonnoslehtiö-teemalla.
**Ei tarvitse palvelinta.** Peli on pelkkiä staattisia tiedostoja, jotka voi julkaista
ilmaiseksi GitHub Pagesissa – pelin luojan selain toimii samalla pelin "palvelimena"
ja muut selaimet yhdistyvät siihen suoraan (WebRTC).

- Aulaan liitytään **4 merkin koodilla tai QR-koodilla**
- Peli arpoo piirtäjän ja tarjoaa **5 sanaa yhdestä kategoriasta** (10 s valinta-aika, muuten arvonta)
- Muut näkevät **kategorian ja sanan pituuden**; piirtoajan kuluessa paljastuu kirjaimia satunnaisista kohdista
- Arvaukset näkyvät **puhekuplina kaikille**, oikea arvaus näkyy muille vain vihreänä **"Oikein!"**
- Kierroksia pelataan asetettu määrä niin, että **jokainen piirtää yhtä monta kertaa**
- Piirtotyökaluina värit, paksuudet, viiva, nelikulmio ja ympyrä (ääriviivana tai täytettynä), pyyhekumi, kumoa ja tyhjennä

## Julkaisu GitHub Pagesiin

```bash
git init
git add .
git commit -m "Piirrä ja arvaa"
git branch -M main
git remote add origin https://github.com/KÄYTTÄJÄ/piirra-ja-arvaa.git
git push -u origin main
```

Sitten GitHubissa: **Settings → Pages → Source: Deploy from a branch → main / (root) → Save.**

Minuutin päästä peli on osoitteessa `https://KÄYTTÄJÄ.github.io/piirra-ja-arvaa/`.
Jokainen push päivittää sen automaattisesti. Tämä on ilmaista eikä vaadi mitään muuta palvelua.

Paikallisesti kokeiluun riittää mikä tahansa staattinen palvelin, esim. `python3 -m http.server 8000`.

## Miten se toimii ilman palvelinta

Pelin luojan selain ajaa pelin säännöt (`engine.js`) ja välittää tapahtumat muille.
Selaimet löytävät toisensa PeerJS:n ilmaisen **kättelypalvelimen** kautta – sen läpi kulkee
vain "kuka on missäkin", ei itse peli. Piirrot, arvaukset ja pisteet menevät suoraan
laitteelta laitteelle.

**Mitä tästä seuraa:**

- 🔸 **Pelin luojan välilehti pitää olla auki kesken pelin.** Jos hän sulkee sen, kesken oleva peli keskeytyy – mutta peli ei kaadu: joku muista ottaa saman pelikoodin haltuunsa muutamassa sekunnissa, kaikki siirtyvät aulaan ja uusi pelinjohtaja voi aloittaa uuden pelin. Pisteet nollautuvat, koska peli pyöri edellisen johtajan laitteella.
- 🔸 Puhelimessa kannattaa pitää näyttö hereillä pelin luojan laitteella – taustalle mennyt välilehti pysäyttää ajastimet.
- 🔸 Samassa wifissä yhteys toimii käytännössä aina. Eri verkoista (esim. osa 4G:llä) yhteys onnistuu useimmiten STUN-palvelimien avulla, mutta tiukka mobiili- tai yritysverkko voi estää suoran yhteyden. Silloin tarvitaan TURN-palvelin: kohta `PEER_CONFIG` tiedostossa `net.js` kertoo, mihin sen tiedot laitetaan.

Jos haluat joskus varmemman yhteyden ilman näitä rajoituksia, sama pelilogiikka toimisi myös
tavallisella Node-palvelimella – mutta silloin tarvitaan taas palvelin, mitä tässä nimenomaan vältetään.

## Pelin kulku

| Vaihe | Kesto | Mitä tapahtuu |
|---|---|---|
| Sanan valinta | 10 s | Piirtäjä valitsee 5 vaihtoehdosta, muuten peli arpoo |
| Piirtäminen | 20–300 s (oletus 80 s) | Arvaukset chattiin, kirjaimia paljastuu vähitellen |
| Tulokset | 6 s | Sana paljastetaan ja pisteet näytetään |

**Pisteet.** Arvaaja saa 120–400 pistettä sen mukaan, kuinka paljon aikaa oli jäljellä,
ja ensimmäinen oikein arvannut +40 bonusta. Piirtäjä saa 50–140 pistettä jokaisesta
oikein arvanneesta. Jos yhteys katkeaa kesken pelin, samalla nimellä palaava saa pisteensä takaisin.

**Kesken pelin liittyminen.** Kun peli on alkanut, mukaan pääsee vain se, joka oli pelissä
aloitushetkellä – esimerkiksi jos yhteys katkesi. Tunnistus tapahtuu nimen perusteella:
kirjoita täsmälleen sama nimi kuin aiemmin, niin saat pisteesi ja piirtovuorosi takaisin.
Muut saavat selkeän ilmoituksen siitä, että peli on jo käynnissä.

**Poistuminen.** Poistunut katoaa pelaajalistalta heti. Jos poistuja oli piirtäjä, vuoro
päättyy automaattisesti, sana paljastetaan kaikille ja peli siirtyy seuraavaan vuoroon.

Peli estää vahingossa tapahtuvat vuodot: piirtäjän ja jo oikein arvanneiden viestit näkyvät
vain heille. Lähelle osunut arvaus kertoo arvaajalle yksityisesti "lähellä!".

## Asennus puhelimen kotinäytölle

Peli on asennettava selainsovellus (PWA). Avaa peli puhelimessa ja valitse selaimen valikosta
**Lisää kotinäyttöön**. Sen jälkeen se avautuu omalla kuvakkeellaan ilman selaimen osoiterivia.
Vaatii https-osoitteen, joten GitHub Pages käy sellaisenaan.

## Versiot

Versionumero näkyy aloitussivun alalaidassa ja on tallennettu kahteen paikkaan:
`GAME_VERSION` tiedostossa `app.js`, `VERSION` tiedostossa `sw.js` sekä `version.json`.
**Päivitä kaikki kolme samalla**, kun julkaiset muutoksia. Peli vertaa käynnissä olevaa
versiota tiedostoon `version.json` ja tarjoaa vanhentuneelle pelaajalle päivitysnapin,
joka tyhjentää välimuistin – pelaajan nimi säilyy.

## Julkiset pelit

Pelin luoja voi rastittaa aulassa kohdan "Näytä peli aloitussivun avoimissa peleissä",
jolloin peli ilmestyy muiden aloitussivulle koodeineen ja tilatietoineen.

Tämäkin toimii ilman palvelinta: julkisia paikkoja on kahdeksan (`pja-open-1` … `pja-open-8`),
ja julkinen peli varaa niistä ensimmäisen vapaan. Aloitussivu kysyy jokaiselta paikalta
tiedot ja listaa vastanneet. Tästä seuraa kaksi rajoitusta: **julkisia pelejä voi olla
kerrallaan enintään kahdeksan**, ja lista tyhjenee itsestään kun pelit päättyvät.
Paikkojen määrää voi kasvattaa muuttujasta `OPEN_SLOTS` tiedostossa `net.js`.

## Omat sanat ja säädöt

- **Sanat ja kategoriat:** `words.js` – 15 kategoriaa, ~400 sanaa. Lisää omia vapaasti.
- **Ajat ja pistelaskenta:** `engine.js` (vakiot tiedoston alussa).
- **Värit, fontit, paperin ulkoasu:** `styles.css` (`:root`-muuttujat).
- **Piirtotyökalut:** `app.js` (taulukot `TOOLS`, `COLORS`, `WIDTHS`).
- **Yhteysasetukset (STUN/TURN, oma kättelypalvelin):** `net.js` (`PEER_CONFIG`).

## Rakenne

```
index.html   Aloitus-, aula- ja peliruutu
styles.css   Luonnoslehtiö-teema
app.js       Käyttöliittymä: aula, chat, työkalupalkki, modaalit
engine.js    Pelin säännöt – ajetaan pelin luojan selaimessa
net.js       Yhteydet selainten välillä (PeerJS/WebRTC)
draw.js      Piirtoalusta ja työkalut
qr.js        Oma QR-generaattori, ei ulkoisia kirjastoja
words.js     Sanastot
vendor/      PeerJS-kirjasto mukana repossa (MIT), ei CDN-riippuvuutta
test/        Testit (vaativat Nodea, eivät kuulu julkaistuun peliin)
```

Selainpuolella ei ole rakennusvaihetta: pelkkää HTML:ää, CSS:ää ja JavaScriptiä.
Fontit haetaan Google Fontsista; ilman nettiä peli käyttää järjestelmän käsialafontteja.

## Testit

```bash
npm install          # asentaa vain jsdomin testejä varten
npm test             # pelin säännöt: 3 pelaajaa pelaa pelin läpi
npm run test:ui      # kaksi "selainta" pelaa vuoron läpi, PeerJS mockattuna
```

## Lisenssi

MIT. Mukana toimitettu PeerJS on samoin MIT-lisensoitu, ks. `vendor/PEERJS-LICENSE`.
