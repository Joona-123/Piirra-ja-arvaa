/* Sanakategoriat. Lisää omia sanoja vapaasti – muutokset näkyvät heti sivun latauksessa.
   Pidä sanat helposti piirrettävinä. */
(function (root) {

var CATEGORIES = [
  {
    name: 'Eläimet',
    words: ['koira', 'kissa', 'norsu', 'kirahvi', 'pingviini', 'hai', 'kilpikonna', 'orava', 'siili',
      'kettu', 'karhu', 'hevonen', 'lehmä', 'sammakko', 'lepakko', 'mehiläinen', 'perhonen', 'käärme',
      'delfiini', 'papukaija', 'kana', 'lammas', 'hylje', 'valas', 'kotka', 'hämähäkki', 'krokotiili',
      'jänis', 'apina', 'leijona', 'poro', 'ankka']
  },
  {
    name: 'Ruoka ja juoma',
    words: ['pizza', 'hampurilainen', 'jäätelö', 'banaani', 'omena', 'mansikka', 'leipä', 'juusto',
      'makkara', 'spagetti', 'kakku', 'donitsi', 'popcorn', 'sushi', 'keitto', 'ananas', 'porkkana',
      'kahvi', 'maito', 'suklaa', 'salaatti', 'kananmuna', 'pannukakku', 'karkki', 'vesimeloni',
      'peruna', 'ranskalaiset', 'lettu', 'sipuli', 'chilipaprika']
  },
  {
    name: 'Urheilu ja pelit',
    words: ['jalkapallo', 'koripallo', 'jääkiekko', 'tennis', 'hiihto', 'uinti', 'nyrkkeily', 'golf',
      'sulkapallo', 'luistelu', 'laskettelu', 'keihäänheitto', 'maraton', 'pyöräily', 'jooga', 'shakki',
      'biljardi', 'surffaus', 'kiipeily', 'ratsastus', 'curling', 'salibandy', 'mäkihyppy', 'sumopaini',
      'lentopallo', 'darts', 'soutu', 'trampoliini']
  },
  {
    name: 'Ammatit',
    words: ['lääkäri', 'palomies', 'poliisi', 'opettaja', 'kokki', 'astronautti', 'muusikko', 'maalari',
      'kirjailija', 'tarjoilija', 'parturi', 'rakennusmies', 'lentäjä', 'merirosvo', 'ritari', 'taikuri',
      'klovni', 'sukeltaja', 'puutarhuri', 'kalastaja', 'tuomari', 'sairaanhoitaja', 'arkkitehti',
      'näyttelijä', 'postinkantaja', 'nuohooja', 'leipuri', 'valokuvaaja']
  },
  {
    name: 'Koti ja esineet',
    words: ['sohva', 'jääkaappi', 'lamppu', 'peili', 'tuoli', 'sänky', 'hammasharja', 'sateenvarjo',
      'avain', 'herätyskello', 'tikkaat', 'harja', 'kynttilä', 'tyyny', 'ämpäri', 'saippua', 'lompakko',
      'silmälasit', 'kamera', 'kirja', 'sakset', 'vasara', 'matto', 'pesukone', 'kahvinkeitin',
      'roskakori', 'verho', 'hiustenkuivaaja', 'kynttilänjalka', 'kirjahylly']
  },
  {
    name: 'Liikenne',
    words: ['auto', 'polkupyörä', 'juna', 'lentokone', 'laiva', 'helikopteri', 'moottoripyörä',
      'kuorma-auto', 'traktori', 'purjevene', 'kuumailmapallo', 'raketti', 'sukellusvene', 'bussi',
      'taksi', 'ambulanssi', 'paloauto', 'skootteri', 'kanootti', 'rekka', 'metro', 'potkulauta',
      'liikennevalot', 'ruohonleikkuri', 'lumilinko', 'moottorikelkka']
  },
  {
    name: 'Luonto',
    words: ['puu', 'kukka', 'vuori', 'joki', 'meri', 'metsä', 'aavikko', 'saari', 'luola', 'vesiputous',
      'kuu', 'aurinko', 'tähti', 'pilvi', 'sateenkaari', 'tulivuori', 'ruoho', 'kivi', 'lehti', 'käpy',
      'jäävuori', 'koski', 'niitty', 'ranta', 'kaktus', 'sieni', 'palmu', 'lampi']
  },
  {
    name: 'Sää ja vuodenajat',
    words: ['sade', 'lumisade', 'myrsky', 'salama', 'ukkonen', 'sumu', 'pakkanen', 'helle', 'tuuli',
      'raesade', 'kevät', 'kesä', 'syksy', 'talvi', 'lumiukko', 'jääpuikko', 'revontulet', 'auringonlasku',
      'halla', 'räntä', 'hanki', 'tuisku', 'kaste', 'pyry']
  },
  {
    name: 'Kehon osat',
    words: ['pää', 'käsi', 'jalka', 'silmä', 'korva', 'nenä', 'suu', 'hammas', 'sormi', 'varvas',
      'polvi', 'kyynärpää', 'olkapää', 'sydän', 'aivot', 'kieli', 'kulmakarva', 'selkä', 'vatsa',
      'luuranko', 'lihas', 'kynsi', 'ripset', 'hiukset', 'nyrkki', 'jalkaterä']
  },
  {
    name: 'Sadut ja taruolennot',
    words: ['lohikäärme', 'yksisarvinen', 'noita', 'velho', 'haltija', 'peikko', 'aave', 'vampyyri',
      'zombi', 'merenneito', 'jättiläinen', 'keiju', 'ritari', 'taikasauva', 'joulupukki', 'örkki',
      'ihmissusi', 'kääpiö', 'taikapeili', 'aarrearkku', 'linna', 'luuta', 'kristallipallo', 'muumio',
      'lohikäärmeen muna', 'taikalamppu']
  },
  {
    name: 'Musiikki',
    words: ['kitara', 'rumpu', 'piano', 'viulu', 'trumpetti', 'huilu', 'harmonikka', 'mikrofoni',
      'nuotti', 'kuulokkeet', 'levysoitin', 'ksylofoni', 'harppu', 'saksofoni', 'basso', 'tuuba',
      'kellopeli', 'karaoke', 'orkesteri', 'kuoro', 'laulaja', 'sello', 'triangeli', 'kaiutin',
      'nuottiteline', 'marakassi']
  },
  {
    name: 'Paikat ja rakennukset',
    words: ['koulu', 'sairaala', 'kirkko', 'majakka', 'silta', 'torni', 'mylly', 'kauppa', 'kirjasto',
      'museo', 'teltta', 'iglu', 'linna', 'asema', 'huvipuisto', 'uimahalli', 'ravintola', 'hotelli',
      'eläintarha', 'satama', 'lentokenttä', 'sauna', 'mökki', 'kerrostalo', 'leikkipuisto', 'navetta']
  },
  {
    name: 'Avaruus ja tiede',
    words: ['raketti', 'planeetta', 'avaruusalus', 'astronautti', 'teleskooppi', 'mikroskooppi',
      'koeputki', 'magneetti', 'robotti', 'atomi', 'galaksi', 'meteoriitti', 'satelliitti', 'ufo',
      'painovoima', 'kompassi', 'aurinkokunta', 'laboratorio', 'hehkulamppu', 'akku', 'kiikarit',
      'rengasplaneetta', 'kuurakkuli', 'komeetta']
  },
  {
    name: 'Tekemiset',
    words: ['nukkuminen', 'juoksu', 'hyppääminen', 'uiminen', 'tanssiminen', 'nauraminen', 'itkeminen',
      'syöminen', 'lukeminen', 'laulaminen', 'kalastus', 'leipominen', 'siivoaminen', 'halaaminen',
      'kiipeäminen', 'putoaminen', 'maalaaminen', 'aivastus', 'haukottelu', 'kättely', 'piiloutuminen',
      'hiihtäminen', 'soittaminen', 'nikottelu']
  },
  {
    name: 'Vaatteet',
    words: ['hattu', 'takki', 'saappaat', 'sukat', 'hanskat', 'huivi', 'mekko', 'farkut', 'paita',
      'solmio', 'kruunu', 'aurinkolasit', 'lippalakki', 'sadetakki', 'uimapuku', 'kengät', 'vyö',
      'laukku', 'sormus', 'kaulakoru', 'pipo', 'essu', 'kylpytakki', 'hame', 'sukkahousut', 'toppatakki']
  }
];

root.CATEGORIES = CATEGORIES;
if (typeof module !== 'undefined' && module.exports) module.exports = CATEGORIES;

})(typeof window !== 'undefined' ? window : globalThis);
