// Fictional nations with distinct linguistic flavours. Names are assembled from
// syllable pools so a world can be arbitrarily large without repeating itself,
// while a handful of signature cities give each nation a recognisable anchor.

export const NATIONS = [
  {
    id: 'ALB', name: 'Albion', adj: 'Albian', currency: '£', rep: 95, wealth: 1.0, youthRep: 88,
    style: { technique: 0, physical: 2, pace: 1, mental: 0 },
    signatureCities: ['Wexholm', 'Ashford', 'Brindleton', 'Harrowgate', 'Caldmere', 'Stanwick', 'Thornbury', 'Eastmarch'],
    citySyl: {
      start: ['Ash', 'Brack', 'Cald', 'Dun', 'East', 'Fen', 'Grim', 'Hal', 'Kes', 'Lam', 'Mar', 'North', 'Ox', 'Pen', 'Rock', 'Stan', 'Thorn', 'West', 'Wyn', 'Yar'],
      mid: ['', '', 'ing', 'en', 'er', 'ble', 'der', 'ming'],
      end: ['ford', 'ton', 'bury', 'holm', 'wick', 'mere', 'gate', 'field', 'brook', 'shire', 'combe', 'dale', 'port', 'stead', 'moor', 'chester'],
    },
    clubAffix: { pre: ['', '', '', '', 'Royal '], post: ['United', 'City', 'Town', 'Rovers', 'Wanderers', 'Athletic', 'County', 'Albion', 'FC', 'Forest', 'Villa', 'Orient'] },
    firstNames: ['James', 'Harry', 'Jack', 'Oliver', 'Callum', 'Ryan', 'Lewis', 'Kyle', 'Dean', 'Marcus', 'Reece', 'Tyler', 'Connor', 'Jordan', 'Ashley', 'Nathan', 'Liam', 'Owen', 'Charlie', 'George', 'Alfie', 'Joe', 'Ben', 'Sam', 'Luke', 'Adam', 'Danny', 'Scott', 'Craig', 'Wayne', 'Declan', 'Mason', 'Jude', 'Bukayo', 'Kobbie', 'Ellis', 'Rhys', 'Finley', 'Archie', 'Theo'],
    surnames: ['Ashworth', 'Bracewell', 'Cartwright', 'Dobson', 'Ellery', 'Fairbrother', 'Gatting', 'Hollis', 'Ibbotson', 'Jarvis', 'Kemsley', 'Langton', 'Marsden', 'Nettleton', 'Oakley', 'Pemberton', 'Quigley', 'Rudkin', 'Sedgwick', 'Thurlow', 'Underhill', 'Vaisey', 'Wadsworth', 'Yelland', 'Barlow', 'Chadwick', 'Dunmore', 'Ferris', 'Grimshaw', 'Hartnell', 'Keswick', 'Lindley', 'Moss', 'Nightingale', 'Pickford', 'Ravenhill', 'Stroud', 'Tattersall', 'Warburton', 'Whitlock', 'Ackroyd', 'Bramhall', 'Colfax', 'Dearden', 'Eastwood', 'Fenwick'],
  },
  {
    id: 'CAS', name: 'Castilia', adj: 'Castilian', currency: '€', rep: 93, wealth: 0.92, youthRep: 90,
    style: { technique: 2, physical: -1, pace: 0, mental: 1 },
    signatureCities: ['Valmeda', 'Soleria', 'Alcazarra', 'Montebrio', 'Ribalta', 'Cadenas', 'Puerto Lirio', 'Sierra Nueva'],
    citySyl: {
      start: ['Al', 'Bar', 'Cas', 'Cor', 'Gran', 'Lor', 'Mal', 'Mon', 'Nav', 'Ovi', 'Pal', 'Sal', 'Seg', 'Tor', 'Val', 'Zar'],
      mid: ['a', 'e', 'i', 'ca', 'de', 'ta', 'men', 'bri'],
      end: ['rra', 'dena', 'ria', 'lona', 'drid', 'via', 'nte', 'gosa', 'mar', 'cia', 'billa', 'lago', 'reno', 'nesa'],
    },
    clubAffix: { pre: ['', '', 'Real ', 'Atlético ', 'Deportivo ', 'Sporting ', 'Racing ', 'CD ', 'UD '], post: ['', '', '', 'CF', 'FC'] },
    firstNames: ['Álvaro', 'Sergio', 'Iker', 'Pablo', 'Javier', 'Rubén', 'Marcos', 'Iván', 'Diego', 'Rodrigo', 'Nacho', 'Unai', 'Mikel', 'Aitor', 'Gonzalo', 'Hugo', 'Adrián', 'Borja', 'Carlos', 'Dani', 'Fernando', 'Gerard', 'Isco', 'Joaquín', 'Lucas', 'Mateo', 'Nico', 'Óscar', 'Pedro', 'Raúl', 'Saúl', 'Tomás', 'Víctor', 'Xabi', 'Yeray', 'Ansu', 'Bryan', 'Ferran'],
    surnames: ['Alcántara', 'Bermejo', 'Calderón', 'Duarte', 'Esparza', 'Fuentes', 'Gallardo', 'Herrera', 'Iglesias', 'Jiménez', 'Lozano', 'Maldonado', 'Navarrete', 'Orozco', 'Peñaranda', 'Quintana', 'Rivas', 'Salazar', 'Tejada', 'Ulloa', 'Valdés', 'Zambrano', 'Aguirre', 'Barrios', 'Cañizares', 'Delgado', 'Escudero', 'Ferrán', 'Gómez', 'Hidalgo', 'Linares', 'Montoya', 'Nogales', 'Olmedo', 'Pardo', 'Requena', 'Sanabria', 'Torralba', 'Vergara', 'Yáñez'],
  },
  {
    id: 'LOM', name: 'Lombardia', adj: 'Lombard', currency: '€', rep: 90, wealth: 0.88, youthRep: 82,
    style: { technique: 1, physical: 0, pace: -1, mental: 3 },
    signatureCities: ['Verdenza', 'Castellino', 'Porto Amaro', 'Reggiano', 'Sant’Elmo', 'Fiorentia', 'Maranelli', 'Lucera'],
    citySyl: {
      start: ['Bre', 'Cas', 'Fio', 'Gen', 'Luc', 'Mar', 'Nap', 'Par', 'Reg', 'Sal', 'Tor', 'Udi', 'Ver', 'Vic'],
      mid: ['a', 'e', 'i', 'el', 'en', 'an', 'or', 'ti'],
      end: ['ano', 'ese', 'ini', 'oli', 'enza', 'ina', 'etta', 'ona', 'ero', 'anti', 'orino', 'ezia'],
    },
    clubAffix: { pre: ['', '', 'AC ', 'US ', 'AS ', 'FC ', 'Inter '], post: ['', '', '', 'Calcio', '1908', '1919'] },
    firstNames: ['Alessandro', 'Marco', 'Lorenzo', 'Matteo', 'Federico', 'Gianluca', 'Nicolò', 'Davide', 'Andrea', 'Simone', 'Riccardo', 'Fabio', 'Stefano', 'Giacomo', 'Emanuele', 'Cristian', 'Domenico', 'Luca', 'Michele', 'Paolo', 'Roberto', 'Samuele', 'Tommaso', 'Vincenzo', 'Daniele', 'Enrico', 'Filippo', 'Giuseppe', 'Leonardo', 'Massimo'],
    surnames: ['Andreotti', 'Bellandi', 'Colombani', 'Ditolla', 'Esposito', 'Ferraris', 'Gallinari', 'Iannotta', 'Lombardi', 'Marchetti', 'Nardelli', 'Orsini', 'Pellegatti', 'Quarta', 'Ravaglia', 'Sartori', 'Tomasino', 'Ubaldi', 'Vialli', 'Zaccardo', 'Barzagli', 'Cassano', 'Donnarumma', 'Frattesi', 'Gatti', 'Immobile', 'Locatelli', 'Mancini', 'Nicolato', 'Piccoli', 'Rugani', 'Scamacca', 'Tonali', 'Vergani', 'Zanetti'],
  },
  {
    id: 'ALE', name: 'Alemannia', adj: 'Alemann', currency: '€', rep: 91, wealth: 0.95, youthRep: 86,
    style: { technique: 0, physical: 1, pace: 0, mental: 2 },
    signatureCities: ['Eisenstadt', 'Hohenbach', 'Rheinfelde', 'Nordhafen', 'Kirchberg', 'Waldheim', 'Steinbrück', 'Altmark'],
    citySyl: {
      start: ['Alt', 'Berg', 'Dorn', 'Eisen', 'Frei', 'Grün', 'Hohen', 'Kirch', 'Lang', 'Neu', 'Nord', 'Ober', 'Rhein', 'Stein', 'Wald', 'Weiss'],
      mid: ['', '', 'en', 'er', 'ens'],
      end: ['stadt', 'berg', 'bach', 'burg', 'heim', 'feld', 'hafen', 'furt', 'tal', 'brück', 'au', 'ingen', 'dorf', 'mark'],
    },
    clubAffix: { pre: ['', '', 'FC ', 'SV ', 'VfB ', 'Borussia ', 'Eintracht ', '1. FC ', 'TSV ', 'Hertha '], post: ['', '', '', '04', '96', '1900'] },
    firstNames: ['Lukas', 'Jonas', 'Niklas', 'Maximilian', 'Leon', 'Felix', 'Tobias', 'Florian', 'Sebastian', 'Kai', 'Jannik', 'Moritz', 'Erik', 'Julian', 'Marvin', 'Pascal', 'Dominik', 'Christoph', 'Andreas', 'Matthias', 'Sven', 'Thilo', 'Nico', 'Robin', 'Bastian', 'Timo', 'Youssoufa', 'Malik', 'Karim', 'Serge'],
    surnames: ['Ackermann', 'Brandtner', 'Dietrich', 'Eberhardt', 'Fischbach', 'Gundlach', 'Hofmeister', 'Ilgner', 'Jungwirth', 'Kalteneder', 'Lindemann', 'Mühlbauer', 'Neuberger', 'Oswald', 'Pfeiffer', 'Reinhardt', 'Schuster', 'Trapp', 'Ullrich', 'Vogtland', 'Wegener', 'Zimmermann', 'Baumgart', 'Ehrhardt', 'Grünwald', 'Hasselbach', 'Kirchhoff', 'Löwenthal', 'Meinhardt', 'Osterloh', 'Röder', 'Steinhaus', 'Weidenfeller'],
  },
  {
    id: 'GAL', name: 'Gallia', adj: 'Gallian', currency: '€', rep: 87, wealth: 0.84, youthRep: 92,
    style: { technique: 1, physical: 1, pace: 2, mental: 0 },
    signatureCities: ['Valcourt', 'Saint-Rémy', 'Montclair', 'Beauport', 'Roussac', 'Aubervelle', 'Lanvière', 'Clairmont'],
    citySyl: {
      start: ['Beau', 'Cler', 'Mont', 'Saint-', 'Val', 'Lan', 'Aub', 'Rous', 'Char', 'Bour', 'Nan', 'Ren', 'Tou', 'Ver'],
      mid: ['', 'e', 'i', 'an', 'er', 'on'],
      end: ['court', 'mont', 'ville', 'vre', 'sac', 'gnac', 'lieu', 'port', 'ac', 'ans', 'euil', 'nes', 'ange', 'ière'],
    },
    clubAffix: { pre: ['', '', 'AS ', 'FC ', 'Olympique ', 'Racing ', 'Stade ', 'RC ', 'US '], post: ['', '', '', 'FC'] },
    firstNames: ['Antoine', 'Kylian', 'Théo', 'Lucas', 'Hugo', 'Baptiste', 'Maxime', 'Clément', 'Enzo', 'Mattéo', 'Rayan', 'Ousmane', 'Ibrahim', 'Moussa', 'Aurélien', 'Benjamin', 'Corentin', 'Dimitri', 'Florent', 'Gaël', 'Jules', 'Léo', 'Nordi', 'Pierre', 'Quentin', 'Romain', 'Sofiane', 'Warren', 'Yacine', 'Adrien'],
    surnames: ['Aubameyang', 'Berthier', 'Coudert', 'Delaunay', 'Estève', 'Fournier', 'Guillory', 'Hernoux', 'Imbert', 'Jourdain', 'Kimpembe', 'Lavigne', 'Marchand', 'Nkunku', 'Oudin', 'Parmentier', 'Quémard', 'Rabiot', 'Soumaré', 'Thuram', 'Ulrich', 'Vasseur', 'Wattier', 'Yattara', 'Bellegarde', 'Cissokho', 'Doucouré', 'Fofana', 'Gassama', 'Konaté', 'Lemoine', 'Mendy', 'Ndiaye', 'Perrin', 'Sissoko', 'Traoré'],
  },
  {
    id: 'BAT', name: 'Batavia', adj: 'Batavian', currency: '€', rep: 80, wealth: 0.62, youthRep: 94,
    style: { technique: 3, physical: 0, pace: 0, mental: 1 },
    signatureCities: ['Aalsdam', 'Vierhoven', 'Lekkerveen', 'Doornbergen', 'Hoogzand', 'Steenwijk', 'Meerdijk', 'Nieuwpoort'],
    citySyl: {
      start: ['Aal', 'Doorn', 'Groen', 'Hoog', 'Klaar', 'Lek', 'Meer', 'Nieuw', 'Oost', 'Rood', 'Steen', 'Vier', 'Wijk', 'Zand'],
      mid: ['', 'er', 'en', 's'],
      end: ['dam', 'hoven', 'veen', 'bergen', 'zand', 'wijk', 'dijk', 'poort', 'huizen', 'broek', 'kerk', 'laar'],
    },
    clubAffix: { pre: ['', '', 'FC ', 'SC ', 'VV ', 'AZ ', 'PSV ', 'Sparta '], post: ['', '', '', "'34", 'United'] },
    firstNames: ['Daan', 'Sven', 'Bram', 'Jurriën', 'Ruud', 'Wout', 'Cody', 'Teun', 'Mats', 'Stefan', 'Joey', 'Luuk', 'Donny', 'Frenkie', 'Memphis', 'Quilindschy', 'Jeremie', 'Xavi', 'Ryan', 'Micky', 'Steven', 'Noa', 'Guus', 'Thijs', 'Bas', 'Lars'],
    surnames: ['van Aalst', 'Beekhuizen', 'de Bruijn', 'Doornbos', 'Everts', 'van Ginkel', 'Hoogland', 'Janssen', 'Klaassen', 'van Loon', 'Meijers', 'Nieuwkoop', 'Oosterveld', 'Pronk', 'Ruitenberg', 'Slegers', 'Timmerman', 'Veenstra', 'Wijnaldum', 'Zeegers', 'Bakhuys', 'Cruijsberg', 'Dekker', 'Evenblij', 'Grootveld', 'Heerema', 'Kuipers', 'Lindeboom', 'Mulder', 'Roosendaal', 'Verhoeven'],
  },
  {
    id: 'LUS', name: 'Lusitania', adj: 'Lusitanian', currency: '€', rep: 82, wealth: 0.6, youthRep: 91,
    style: { technique: 3, physical: -1, pace: 1, mental: 0 },
    signatureCities: ['Vilamor', 'Serrafonte', 'Braganço', 'Oporto Velho', 'Almadena', 'Coimbria', 'Estrelinha', 'Ribatejo'],
    citySyl: {
      start: ['Al', 'Bra', 'Coim', 'Es', 'Gui', 'Lis', 'Ma', 'Por', 'Ri', 'Ser', 'Vi', 'Fa'],
      mid: ['a', 'e', 'i', 'ta', 'ga', 'ma', 'tre'],
      end: ['bra', 'nto', 'mar', 'rães', 'boa', 'deira', 'fonte', 'linha', 'tejo', 'dena', 'nço', 'ão'],
    },
    clubAffix: { pre: ['', '', 'SC ', 'FC ', 'CD ', 'Sporting ', 'Académica ', 'Vitória '], post: ['', '', '', 'SAD'] },
    firstNames: ['João', 'Rúben', 'Diogo', 'Bruno', 'Gonçalo', 'Nuno', 'Tiago', 'Vitinha', 'Rafael', 'André', 'Bernardo', 'Fábio', 'Gedson', 'Hélder', 'Ivan', 'Jota', 'Leonardo', 'Miguel', 'Otávio', 'Pedro', 'Ricardo', 'Sérgio', 'Tomás', 'Vasco'],
    surnames: ['Almeida', 'Barbosa', 'Carvalho', 'Domingues', 'Esteves', 'Figueiredo', 'Gonçalves', 'Horta', 'Inácio', 'Jesus', 'Loureiro', 'Marques', 'Neves', 'Oliveira', 'Pereira', 'Queirós', 'Ramalho', 'Sarmento', 'Trincão', 'Vilela', 'Azevedo', 'Bragança', 'Cunha', 'Dias', 'Faria', 'Guedes', 'Leitão', 'Moutinho', 'Nascimento', 'Patrício', 'Rocha', 'Sousa'],
  },
  {
    id: 'NOR', name: 'Nordheim', adj: 'Nordic', currency: 'kr', rep: 68, wealth: 0.42, youthRep: 74,
    style: { technique: -1, physical: 3, pace: 0, mental: 1 },
    signatureCities: ['Bjørnvik', 'Frosthavn', 'Lindstrand', 'Kvitfjell', 'Nordvang', 'Sørgard', 'Halvøy', 'Ulvsjø'],
    citySyl: {
      start: ['Bjørn', 'Fjell', 'Frost', 'Gran', 'Hal', 'Kvit', 'Lind', 'Nord', 'Sol', 'Sør', 'Ulv', 'Vind'],
      mid: ['', 's', 'e'],
      end: ['vik', 'havn', 'strand', 'fjell', 'vang', 'gard', 'øy', 'sjø', 'berg', 'näs', 'holm', 'stad'],
    },
    clubAffix: { pre: ['', '', 'IF ', 'IK ', 'FK ', 'BK '], post: ['', '', 'IL', 'BK', 'United'] },
    firstNames: ['Erling', 'Martin', 'Alexander', 'Kristian', 'Emil', 'Mathias', 'Jonas', 'Sander', 'Henrik', 'Ola', 'Fredrik', 'Anders', 'Viktor', 'Oskar', 'Elias', 'Noah', 'Filip', 'Isak', 'Leo', 'Mikkel'],
    surnames: ['Aasgaard', 'Berntsen', 'Dahlberg', 'Eriksson', 'Fjeldstad', 'Gulbrandsen', 'Hagen', 'Iversen', 'Johnsrud', 'Kvamme', 'Lindqvist', 'Mikkelsen', 'Nordby', 'Olsrud', 'Pettersen', 'Rygg', 'Sandvik', 'Thorsen', 'Ulriksen', 'Vangen', 'Wikström', 'Ødegård', 'Brekke', 'Ellingsen', 'Hovland', 'Kjelsrud', 'Nygaard', 'Solskjær'],
  },
  {
    id: 'PLA', name: 'Platina', adj: 'Platinean', currency: '$', rep: 79, wealth: 0.34, youthRep: 96,
    style: { technique: 3, physical: 0, pace: 1, mental: 2 },
    signatureCities: ['Rosarito', 'La Plataforma', 'Puerto Bravo', 'San Estanislao', 'Villa Córdoba', 'Quilmar', 'Avellano', 'Mendosa'],
    citySyl: {
      start: ['Ave', 'Bo', 'Cor', 'La ', 'Men', 'Puerto ', 'Qui', 'Ro', 'San ', 'Villa ', 'Tu', 'Par'],
      mid: ['a', 'e', 'do', 'lla', 'sa', 'ne'],
      end: ['rio', 'doba', 'sario', 'mar', 'lmes', 'tán', 'nedo', 'blo', 'guay', 'raná', 'nicio', 'nova'],
    },
    clubAffix: { pre: ['', '', 'CA ', 'Club ', 'Racing ', 'Independiente ', 'Estudiantes de ', 'Newell’s '], post: ['', '', '', 'Juniors', 'Central', 'FC'] },
    firstNames: ['Lautaro', 'Julián', 'Enzo', 'Alexis', 'Nahuel', 'Franco', 'Thiago', 'Emiliano', 'Facundo', 'Gonzalo', 'Nicolás', 'Exequiel', 'Valentín', 'Matías', 'Santiago', 'Agustín', 'Bruno', 'Cristian', 'Damián', 'Ezequiel', 'Ignacio', 'Joaquín', 'Lisandro', 'Maximiliano'],
    surnames: ['Almirón', 'Barrenechea', 'Cufré', 'Domínguez', 'Escobar', 'Ferreyra', 'Giménez', 'Heredia', 'Iturbe', 'Juárez', 'Kranevitter', 'Lanzini', 'Mac Allister', 'Nández', 'Ocampos', 'Paredes', 'Quintero', 'Rulli', 'Sosa', 'Tagliafico', 'Urzi', 'Vietto', 'Zabaleta', 'Benedetto', 'Carrascal', 'Di María', 'Fazio', 'Galarza', 'Lamela', 'Montiel', 'Otamendi', 'Retegui'],
  },
  {
    id: 'VER', name: 'Verdenia', adj: 'Verdenian', currency: 'R$', rep: 84, wealth: 0.38, youthRep: 98,
    style: { technique: 4, physical: 0, pace: 2, mental: -1 },
    signatureCities: ['São Verdim', 'Praia Grande', 'Ouro Serrano', 'Belo Rio', 'Curitanga', 'Fortaleza Nova', 'Recanto', 'Palmares'],
    citySyl: {
      start: ['Belo ', 'Curi', 'For', 'Nova ', 'Ouro ', 'Pal', 'Praia ', 'Re', 'São ', 'Ter', 'Vito', 'Goi'],
      mid: ['a', 'i', 'ta', 'ran', 'ma', 'len'],
      end: ['tiba', 'zonte', 'leza', 'grande', 'mares', 'canto', 'ânia', 'zil', 'polis', 'ntina', 'sópolis', 'verde'],
    },
    clubAffix: { pre: ['', '', 'EC ', 'SC ', 'CR ', 'Grêmio ', 'Atlético ', 'Clube '], post: ['', '', '', 'FC', 'Nacional', 'Paulista'] },
    firstNames: ['Vinícius', 'Rodrygo', 'Gabriel', 'Endrick', 'Matheus', 'Bruno', 'Éverton', 'Wesley', 'Kaio', 'Danilo', 'Lucas', 'Douglas', 'Rafinha', 'Thiago', 'Pedrinho', 'Marquinhos', 'Igor', 'Caio', 'João', 'Luiz', 'Yuri', 'André', 'Savinho', 'Estêvão'],
    surnames: ['Alves', 'Barbosa', 'Cavalcanti', 'Dourado', 'Estrela', 'Ferraz', 'Guimarães', 'Henrique', 'Itaparica', 'Jardim', 'Lemos', 'Machado', 'Nogueira', 'Ourives', 'Paixão', 'Quaresma', 'Rezende', 'Siqueira', 'Teixeira', 'Uchôa', 'Veloso', 'Xavier', 'Zanotti', 'Andrade', 'Bittencourt', 'Coutinho', 'Duarte', 'Fagundes', 'Gouveia', 'Monteiro'],
  },
];

export const NATION_BY_ID = Object.fromEntries(NATIONS.map((n) => [n.id, n]));

/**
 * League pyramids. `tier` 1 is the top flight. `rep` drives club quality,
 * finances and the ability ceiling of generated players.
 */
/**
 * League pyramids. `tier` 1 is the top flight. `rep` drives club quality,
 * finances and the ability ceiling of generated players.
 *
 * Below tier 3 the game changes character: clubs are part-time or amateur,
 * squads are smaller, wages are weekly pocket money and there is essentially
 * no commercial income. `status` is what makes that concrete — see CLUB_STATUS.
 */
export const LEAGUE_TEMPLATES = [
  // --- Albion: the full pyramid, professional down to amateur ---
  { id: 'ALB1', nation: 'ALB', tier: 1, name: 'Albion Premier League', teams: 20, rep: 95, promoted: 0, relegated: 3, tvMoney: 110e6, prize: 2.4e6 },
  { id: 'ALB2', nation: 'ALB', tier: 2, name: 'Albion Championship', teams: 22, rep: 74, promoted: 3, relegated: 3, tvMoney: 9e6, prize: 0.35e6 },
  { id: 'ALB3', nation: 'ALB', tier: 3, name: 'Albion League One', teams: 20, rep: 50, promoted: 3, relegated: 4, tvMoney: 1.6e6, prize: 0.09e6 },
  { id: 'ALB4', nation: 'ALB', tier: 4, name: 'Albion National League', teams: 20, rep: 31, promoted: 3, relegated: 4, tvMoney: 0.22e6, prize: 0.018e6 },
  { id: 'ALB5', nation: 'ALB', tier: 5, name: 'Albion Regional Premier', teams: 18, rep: 17, promoted: 3, relegated: 0, tvMoney: 0.02e6, prize: 0.004e6 },

  // --- The other major nations: professional down to semi-professional ---
  { id: 'CAS1', nation: 'CAS', tier: 1, name: 'Castilian Primera', teams: 20, rep: 93, promoted: 0, relegated: 3, tvMoney: 72e6, prize: 2.0e6 },
  { id: 'CAS2', nation: 'CAS', tier: 2, name: 'Castilian Segunda', teams: 22, rep: 68, promoted: 3, relegated: 4, tvMoney: 6e6, prize: 0.25e6 },
  { id: 'CAS3', nation: 'CAS', tier: 3, name: 'Castilian Primera Federación', teams: 20, rep: 39, promoted: 3, relegated: 0, tvMoney: 0.5e6, prize: 0.04e6 },
  { id: 'LOM1', nation: 'LOM', tier: 1, name: 'Lombard Serie Prima', teams: 20, rep: 90, promoted: 0, relegated: 3, tvMoney: 62e6, prize: 1.8e6 },
  { id: 'LOM2', nation: 'LOM', tier: 2, name: 'Lombard Serie Seconda', teams: 20, rep: 66, promoted: 3, relegated: 4, tvMoney: 5e6, prize: 0.22e6 },
  { id: 'LOM3', nation: 'LOM', tier: 3, name: 'Lombard Serie Terza', teams: 18, rep: 37, promoted: 3, relegated: 0, tvMoney: 0.4e6, prize: 0.035e6 },
  { id: 'ALE1', nation: 'ALE', tier: 1, name: 'Alemann Bundesliga', teams: 18, rep: 91, promoted: 0, relegated: 3, tvMoney: 68e6, prize: 1.9e6 },
  { id: 'ALE2', nation: 'ALE', tier: 2, name: 'Alemann 2. Liga', teams: 18, rep: 69, promoted: 3, relegated: 3, tvMoney: 7e6, prize: 0.28e6 },
  { id: 'ALE3', nation: 'ALE', tier: 3, name: 'Alemann 3. Liga', teams: 18, rep: 41, promoted: 3, relegated: 0, tvMoney: 0.8e6, prize: 0.05e6 },
  { id: 'GAL1', nation: 'GAL', tier: 1, name: 'Gallian Ligue Première', teams: 18, rep: 87, promoted: 0, relegated: 3, tvMoney: 48e6, prize: 1.5e6 },
  { id: 'GAL2', nation: 'GAL', tier: 2, name: 'Gallian Ligue Deux', teams: 20, rep: 62, promoted: 3, relegated: 4, tvMoney: 4e6, prize: 0.18e6 },
  { id: 'GAL3', nation: 'GAL', tier: 3, name: 'Gallian National', teams: 18, rep: 35, promoted: 3, relegated: 0, tvMoney: 0.35e6, prize: 0.03e6 },

  // --- Smaller nations: a top flight and one division beneath it ---
  { id: 'BAT1', nation: 'BAT', tier: 1, name: 'Batavian Eredivisie', teams: 18, rep: 80, promoted: 0, relegated: 2, tvMoney: 22e6, prize: 0.9e6 },
  { id: 'BAT2', nation: 'BAT', tier: 2, name: 'Batavian Eerste Divisie', teams: 16, rep: 46, promoted: 2, relegated: 0, tvMoney: 1.2e6, prize: 0.07e6 },
  { id: 'LUS1', nation: 'LUS', tier: 1, name: 'Lusitanian Liga', teams: 18, rep: 82, promoted: 0, relegated: 2, tvMoney: 24e6, prize: 1.0e6 },
  { id: 'LUS2', nation: 'LUS', tier: 2, name: 'Lusitanian Liga Dois', teams: 16, rep: 45, promoted: 2, relegated: 0, tvMoney: 1.0e6, prize: 0.06e6 },
  { id: 'NOR1', nation: 'NOR', tier: 1, name: 'Nordheim Eliteserien', teams: 16, rep: 68, promoted: 0, relegated: 2, tvMoney: 7e6, prize: 0.3e6 },
  { id: 'NOR2', nation: 'NOR', tier: 2, name: 'Nordheim Førstedivisjon', teams: 14, rep: 39, promoted: 2, relegated: 0, tvMoney: 0.5e6, prize: 0.03e6 },
  { id: 'PLA1', nation: 'PLA', tier: 1, name: 'Platina Primera División', teams: 20, rep: 79, promoted: 0, relegated: 2, tvMoney: 14e6, prize: 0.6e6 },
  { id: 'PLA2', nation: 'PLA', tier: 2, name: 'Platina Primera Nacional', teams: 18, rep: 44, promoted: 2, relegated: 0, tvMoney: 0.7e6, prize: 0.045e6 },
  { id: 'VER1', nation: 'VER', tier: 1, name: 'Verdenian Série A', teams: 20, rep: 84, promoted: 0, relegated: 4, tvMoney: 18e6, prize: 0.8e6 },
  { id: 'VER2', nation: 'VER', tier: 2, name: 'Verdenian Série B', teams: 18, rep: 48, promoted: 4, relegated: 0, tvMoney: 1.4e6, prize: 0.08e6 },
];

/**
 * What kind of club this is, derived from its reputation. This is the field
 * that makes the bottom of the pyramid a different job rather than a smaller
 * version of the same one: it sets squad size, how hard players can train,
 * how long they will sign for, and whether wages are a career or a supplement.
 */
export const CLUB_STATUS = {
  professional: {
    id: 'professional', label: 'Professional', minRep: 50,
    squadSize: 26, trainingMult: 1.0, contractYears: [1, 4], wageMult: 1.0,
  },
  'part-time': {
    id: 'part-time', label: 'Part-time', minRep: 30,
    squadSize: 21, trainingMult: 0.72, contractYears: [1, 2], wageMult: 0.5,
  },
  amateur: {
    id: 'amateur', label: 'Amateur', minRep: 0,
    squadSize: 18, trainingMult: 0.5, contractYears: [1, 1], wageMult: 0.16,
  },
};

/**
 * Squad ability from club reputation.
 *
 * This was a straight line from 52 to 156, which gave the whole world a 2.1x
 * ability range against a 22x money range — a bottom-division club was a poor
 * top-flight club rather than a different kind of football. A power curve keeps
 * the top where it was (match calibration depends on it) and stretches the
 * bottom into genuinely amateur territory.
 *
 * It lives here, beside the league templates, because four separate modules
 * need it and three of them used to carry their own copy.
 */
export function abilityForReputation(rep) {
  // The original curve was a straight line from reputation 20 upward, clamped
  // flat below it — which is precisely why the bottom of the pyramid was a rich
  // second tier: a village side on reputation 8 and a lower-league club on 20
  // were handed identical squads. Extending the same line downward is the whole
  // fix. It leaves every division that already existed exactly where the match
  // engine was calibrated against it and only changes the tiers underneath.
  //
  // A power curve was tried first and rejected: it lifted the middle of the
  // pyramid by ten to fourteen points, which moved goals per match +4% and draws
  // -16% in the top flight. Stretching the bottom must not mean inflating the
  // middle.
  return Math.max(20, Math.min(158, 52 + (rep - 20) * (104 / 79)));
}

/**
 * Annual commercial and sponsorship income. Steep and normalised on reputation,
 * so the money range across the pyramid is as wide as real football's: a giant
 * earns nine figures, a village side earns beer money. The old curve still paid
 * an amateur club eight million a year.
 */
export function commercialIncome(rep, wealth = 1) {
  const t = Math.max(0, Math.min(1, (rep - 8) / 91));
  return Math.pow(t, 4.2) * 205e6 * wealth + 12e3;
}

export function statusForRep(rep) {
  if (rep >= CLUB_STATUS.professional.minRep) return CLUB_STATUS.professional;
  if (rep >= CLUB_STATUS['part-time'].minRep) return CLUB_STATUS['part-time'];
  return CLUB_STATUS.amateur;
}

/**
 * World size presets. These now trade breadth against depth rather than just
 * adding nations: a small world goes all the way down to amateur football, a
 * large one covers every nation but only the divisions near the top. That
 * keeps the simulation cost roughly level across the three choices.
 */
export const WORLD_SIZES = {
  small: {
    label: 'Small — 3 nations, full pyramid',
    hint: 'Fewest nations, but every division down to amateur. Best for starting at the bottom.',
    nations: ['ALB', 'CAS', 'ALE'], maxTier: 5,
  },
  medium: {
    label: 'Medium — 6 nations, down to tier 3',
    hint: 'A broader world with semi-professional football beneath each top flight.',
    nations: ['ALB', 'CAS', 'LOM', 'ALE', 'GAL', 'BAT'], maxTier: 3,
  },
  large: {
    label: 'Large — 10 nations, top two tiers',
    hint: 'Every nation in the game, but only the divisions near the top of each.',
    nations: NATIONS.map((n) => n.id), maxTier: 2,
  },
};

export const CONTINENTAL = {
  id: 'CONT_CUP', name: 'Continental Cup', shortName: 'CC',
  groupTeams: 32, groupSize: 4, prizeGroup: 15e6, prizeWin: 20e6, prizePerRound: 12e6,
};

export const SECONDARY_CONTINENTAL = {
  id: 'CONT_SHIELD', name: 'Continental Shield', shortName: 'CS',
  groupTeams: 32, groupSize: 4, prizeGroup: 4e6, prizeWin: 6e6, prizePerRound: 3e6,
};
