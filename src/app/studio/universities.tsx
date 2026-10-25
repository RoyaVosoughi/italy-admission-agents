// University photos (Wikimedia Commons, CC BY-SA / public domain; credits in /universities/credits.json).
// Photos are matched by name, never guessed: an unknown university simply gets no photo.
import Image from "next/image";

export const UNI_PHOTOS: Record<string, { name: string; city: string }> = {
  bologna: { name: "Università di Bologna", city: "Bologna" },
  polimi: { name: "Politecnico di Milano", city: "Milano" },
  polito: { name: "Politecnico di Torino", city: "Torino" },
  padova: { name: "Università di Padova", city: "Padova" },
  sapienza: { name: "Sapienza Università di Roma", city: "Roma" },
  pisa: { name: "Università di Pisa", city: "Pisa" },
  firenze: { name: "Università di Firenze", city: "Firenze" },
  napoli: { name: "Federico II", city: "Napoli" },
  trento: { name: "Università di Trento", city: "Trento" },
  pavia: { name: "Università di Pavia", city: "Pavia" },
  genova: { name: "Università di Genova", city: "Genova" },
  cafoscari: { name: "Ca' Foscari", city: "Venezia" },
  "statale-milano": { name: "Università degli Studi di Milano", city: "Milano" },
  bari: { name: "Università di Bari", city: "Bari" },
  palermo: { name: "Università di Palermo", city: "Palermo" },
};

const MATCH: [RegExp, string][] = [
  [/politecnico di milano|polimi/i, "polimi"],
  [/politecnico di torino|polito/i, "polito"],
  [/bologna/i, "bologna"],
  [/padova|padua/i, "padova"],
  [/sapienza/i, "sapienza"],
  [/pisa|normale/i, "pisa"],
  [/firenze|florence/i, "firenze"],
  [/federico ii|napoli(?!.*(parthenope|vanvitelli))/i, "napoli"],
  [/trento/i, "trento"],
  [/pavia/i, "pavia"],
  [/genova|genoa/i, "genova"],
  [/ca'? ?foscari/i, "cafoscari"],
  // only the state university: Bocconi, Cattolica, IULM, Bicocca, San Raffaele and Humanitas are other institutions
  [/^(?!.*(bocconi|cattolica|iulm|bicocca|raffaele|humanitas|politecnico)).*milan(o)?/i, "statale-milano"],
  [/bari/i, "bari"],
  [/palermo/i, "palermo"],
];

export function uniKey(name: string): string | null {
  return MATCH.find(([re]) => re.test(name))?.[1] ?? null;
}

const TILT = [-3, 2.5, -2, 4, -4, 3];

/** One polaroid: photo, name, city. `tilt` is an index so a row of cards gets different angles. */
export function UniPolaroid({ k, label, caption, tilt = 0, delay = 0, priority = false }: { k: string; label?: string; caption?: string; tilt?: number; delay?: number; priority?: boolean }) {
  const u = UNI_PHOTOS[k];
  if (!u) return null;
  return (
    <figure className="polaroid polaroid-drop m-0 w-full" style={{ transform: `rotate(${TILT[tilt % TILT.length]}deg)`, ["--d" as string]: `${delay}ms` }}>
      <Image src={`/universities/${k}.jpg`} alt={`${label ?? u.name}, ${u.city}`} width={450} height={338} priority={priority} sizes="(max-width: 640px) 45vw, 220px" />
      <figcaption className="px-2 pt-2.5">
        <p className="truncate text-sm font-semibold leading-tight text-stone-900">{label ?? u.name}</p>
        <p className="mt-0.5 truncate text-xs text-stone-600">{caption ?? u.city}</p>
      </figcaption>
    </figure>
  );
}

/** Decorative scrapbook for the hero; the photos are described by the heading next to them. */
export function HeroCollage() {
  const keys = ["padova", "polimi", "pisa", "cafoscari"];
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4" role="img" aria-label="Photos of Italian universities: Padova, Politecnico di Milano, Pisa and Ca' Foscari">
      {keys.map((k, i) => (
        <div key={k} className={i % 2 ? "mt-6" : ""} aria-hidden="true">
          <UniPolaroid k={k} tilt={i} delay={i * 90} priority={i < 2} />
        </div>
      ))}
    </div>
  );
}
