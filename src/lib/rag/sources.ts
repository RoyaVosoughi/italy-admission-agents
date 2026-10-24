// Explicit registry of knowledge files. Region comes from this table, never from
// the filename: venezia.md turned out to be the Friuli-Venezia Giulia report, and
// Piedmont/Veneto each have more than one file.

export type DocType = "regional" | "national" | "visa" | "pricing";

export interface SourceDoc {
  file: string; // path relative to KB_SOURCE_DIR
  slug: string; // output name in kb/clean
  title: string; // goes into every chunk's prefix so chunks from different docs are distinguishable
  region: string | null; // null for national docs
  dsuBody: string | null;
  docType: DocType;
}

export const SOURCES: SourceDoc[] = [
  { file: "abruzzo.pdf.md", slug: "abruzzo", title: "ADSU scholarships & Abruzzo universities", region: "Abruzzo", dsuBody: "ADSU L'Aquila / ADSU Chieti-Pescara / ADSU Teramo", docType: "regional" },
  { file: "basilicata.pdf.md", slug: "basilicata", title: "ARDSU Basilicata scholarship & University of Basilicata", region: "Basilicata", dsuBody: "ARDSU Basilicata", docType: "regional" },
  { file: "calabria.pdf.md", slug: "calabria", title: "Calabria universities (UNICAL, UNIRC, UMG) & scholarships", region: "Calabria", dsuBody: "university-run DSU (Calabria)", docType: "regional" },
  { file: "campania.pdf.md", slug: "campania", title: "ADiSURC Campania scholarship & Naples universities", region: "Campania", dsuBody: "ADiSURC Campania", docType: "regional" },
  { file: "emilia-romagna.pdf.md", slug: "emilia-romagna", title: "ER.GO scholarship & Emilia-Romagna universities (Bologna, Modena, Parma, Ferrara)", region: "Emilia-Romagna", dsuBody: "ER.GO", docType: "regional" },
  { file: "Friuli-Venezia Giulia.md", slug: "friuli-venezia-giulia", title: "ARDIS scholarship & Trieste, Udine, SISSA", region: "Friuli-Venezia Giulia", dsuBody: "ARDIS", docType: "regional" },
  { file: "lazio.md", slug: "lazio", title: "DiSCo Lazio scholarship & Rome universities", region: "Lazio", dsuBody: "DiSCo Lazio", docType: "regional" },
  { file: "liguria.md", slug: "liguria", title: "ALiSEO scholarship & University of Genoa", region: "Liguria", dsuBody: "ALiSEO", docType: "regional" },
  { file: "lombardy.pdf.md", slug: "lombardy", title: "Lombardy universities (PoliMi, Statale, Bicocca, Pavia) & DSU scholarships", region: "Lombardia", dsuBody: "per-university (EDiSU Pavia for Pavia)", docType: "regional" },
  { file: "marche.md", slug: "marche", title: "ERDIS Marche scholarship & Marche universities", region: "Marche", dsuBody: "ERDIS Marche", docType: "regional" },
  { file: "molise.pdf.md", slug: "molise", title: "ESU Molise & University of Molise", region: "Molise", dsuBody: "ESU Molise", docType: "regional" },
  { file: "piedmont.pdf.md", slug: "piedmont", title: "EDISU Piemonte scholarship & Turin universities", region: "Piemonte", dsuBody: "EDiSU Piemonte", docType: "regional" },
  { file: "piedmont.edisu.md", slug: "piedmont-edisu", title: "EDISU Piemonte scholarship guide", region: "Piemonte", dsuBody: "EDiSU Piemonte", docType: "regional" },
  { file: "puglia.pdf.md", slug: "puglia", title: "ADISU Puglia scholarship & Puglia universities (Bari, Foggia, Salento)", region: "Puglia", dsuBody: "ADISU Puglia", docType: "regional" },
  { file: "sardinia.md", slug: "sardinia", title: "ERSU Cagliari / Sassari scholarships & Sardinia universities", region: "Sardegna", dsuBody: "ERSU Cagliari / ERSU Sassari", docType: "regional" },
  { file: "sicily.pdf.md", slug: "sicily", title: "Sicily ERSU scholarships & Palermo, Catania, Messina, Enna", region: "Sicilia", dsuBody: "ERSU Palermo / Catania / Messina / Enna", docType: "regional" },
  { file: "trentino.md", slug: "trentino", title: "Opera Universitaria Trento, Bolzano & Trentino universities", region: "Trentino-Alto Adige", dsuBody: "Opera Universitaria Trento / Provincia di Bolzano", docType: "regional" },
  { file: "tuscany.pdf.md", slug: "tuscany", title: "DSU Toscana scholarship & Florence, Pisa, Siena universities", region: "Toscana", dsuBody: "DSU Toscana", docType: "regional" },
  { file: "umbria.md", slug: "umbria", title: "ADiSU Umbria scholarship & Perugia universities", region: "Umbria", dsuBody: "ADiSU Umbria", docType: "regional" },
  { file: "valle-daosta.md", slug: "valle-daosta", title: "Valle d'Aosta scholarship & UniVdA", region: "Valle d'Aosta", dsuBody: "Regione Valle d'Aosta", docType: "regional" },
  { file: "veneto.pdf.md", slug: "veneto", title: "ESU scholarships & Veneto universities (Padua, Ca' Foscari, Verona)", region: "Veneto", dsuBody: "ESU Padova / ESU Venezia / ESU Verona", docType: "regional" },
  { file: "Scholarships guid.md", slug: "national-dsu-guide", title: "National guide: DSU right-to-study scholarships for Iranian students", region: null, dsuBody: null, docType: "national" },
  { file: "ENG-checklist-university-enrollment.md", slug: "embassy-visa-checklist", title: "Embassy of Italy in Tehran: study visa document checklist", region: null, dsuBody: null, docType: "visa" },
  { file: "immigration files/knowledge/italy.md", slug: "italy-overview", title: "Italy overview for Iranian applicants: admission, Universitaly, CIMEA, visa", region: null, dsuBody: null, docType: "national" },
  { file: "immigration files/knowledge/costs.md", slug: "costs", title: "Cost of the whole process (client third-party costs)", region: null, dsuBody: null, docType: "pricing" },
  { file: "immigration files/knowledge/agency-pricing.md", slug: "agency-pricing", title: "Agency pricing: our service fees", region: null, dsuBody: null, docType: "pricing" },
];
