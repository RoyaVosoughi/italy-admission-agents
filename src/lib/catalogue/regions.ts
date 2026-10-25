// Province → region, using the region names of the knowledge base (the analyst and scholarship agents
// look up regional reports by these names).
const REGIONS: Record<string, string[]> = {
  Abruzzo: ["Chieti", "L'Aquila", "Pescara", "Teramo"],
  Basilicata: ["Matera", "Potenza"],
  Calabria: ["Catanzaro", "Cosenza", "Crotone", "Reggio Calabria", "Vibo Valentia"],
  Campania: ["Avellino", "Benevento", "Caserta", "Napoli", "Salerno"],
  "Emilia-Romagna": ["Bologna", "Ferrara", "Forlì-Cesena", "Modena", "Parma", "Piacenza", "Ravenna", "Reggio nell'Emilia", "Rimini"],
  "Friuli-Venezia Giulia": ["Gorizia", "Pordenone", "Trieste", "Udine"],
  Lazio: ["Frosinone", "Latina", "Rieti", "Roma", "Viterbo"],
  Liguria: ["Genova", "Imperia", "La Spezia", "Savona"],
  Lombardia: ["Bergamo", "Brescia", "Como", "Cremona", "Lecco", "Lodi", "Mantova", "Milano", "Monza e della Brianza", "Pavia", "Sondrio", "Varese"],
  Marche: ["Ancona", "Ascoli Piceno", "Fermo", "Macerata", "Pesaro e Urbino"],
  Molise: ["Campobasso", "Isernia"],
  Piemonte: ["Alessandria", "Asti", "Biella", "Cuneo", "Novara", "Torino", "Verbano-Cusio-Ossola", "Vercelli"],
  Puglia: ["Bari", "Barletta-Andria-Trani", "Brindisi", "Foggia", "Lecce", "Taranto"],
  Sardegna: ["Cagliari", "Gallura Nord-Est Sardegna", "Nuoro", "Oristano", "Sassari", "Sud Sardegna"],
  Sicilia: ["Agrigento", "Caltanissetta", "Catania", "Enna", "Messina", "Palermo", "Ragusa", "Siracusa", "Trapani"],
  Toscana: ["Arezzo", "Firenze", "Grosseto", "Livorno", "Lucca", "Massa-Carrara", "Pisa", "Pistoia", "Prato", "Siena"],
  "Trentino-Alto Adige": ["Bolzano/Bozen", "Trento"],
  Umbria: ["Perugia", "Terni"],
  "Valle d'Aosta": ["Valle d'Aosta/Vallée d'Aoste"],
  Veneto: ["Belluno", "Padova", "Rovigo", "Treviso", "Venezia", "Verona", "Vicenza"],
};

const BY_PROVINCE = new Map<string, string>();
for (const [region, provinces] of Object.entries(REGIONS)) for (const p of provinces) BY_PROVINCE.set(p.toLowerCase(), region);

export function regionOfProvince(province: string): string | null {
  return BY_PROVINCE.get(province.trim().toLowerCase()) ?? null;
}
