import type { KduRule, ListingItem } from '@/types/immo';

export type LetterTone = 'natural' | 'compact' | 'formal' | 'warm';

export interface LetterOptions {
  listing: ListingItem;
  rule: KduRule;
  bgSize: number;
  benefitType: 'sgb2' | 'sgb12';
  applicantName?: string;
  phone?: string;
  moveInDate?: string;
  personalNote?: string;
  emphasizeDirectTransfer?: boolean;
  addressSchufaDirectly?: boolean;
  tone?: LetterTone;
  variantIndex?: number;
}

export interface ToneMeta {
  key: LetterTone;
  label: string;
  description: string;
  badge: string;
}

export const LETTER_TONES: ToneMeta[] = [
  {
    key: 'natural',
    label: 'Natürlich & Direkt',
    description: 'Freundlich & menschlich – perfekt für Privatvermieter und E-Mails',
    badge: '🌱 Natürlich',
  },
  {
    key: 'compact',
    label: 'Kompakt (Chat)',
    description: 'Kurz & prägnant – ideal für Kleinanzeigen-Messenger & Smartphone',
    badge: '⚡ Kompakt',
  },
  {
    key: 'formal',
    label: 'Sachlich & Seriös',
    description: 'Klassisch strukturiert – ideal für Hausverwaltungen & Gesellschaften',
    badge: '🏢 Seriös',
  },
  {
    key: 'warm',
    label: 'Sympathisch & Familiär',
    description: 'Herzlich & bodenständig – besonders für Paare, Familien & Gemeinschaften',
    badge: '🏡 Familiär',
  },
];

function formatEur(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '–';
  return `${val.toFixed(2).replace('.', ',')} €`;
}

function resolveSalutation(listing: ListingItem, tone: LetterTone, variant: number): string {
  const rawContact = (listing.contact_name || '').trim();

  // If there's a specific contact name that isn't a generic placeholder
  const isGeneric =
    !rawContact ||
    /^(anbieter|vermieter|wohnungsaushang|privater nutzer|kontakt|verwaltung)$/i.test(rawContact);

  if (!isGeneric) {
    if (/\bHerr\b/i.test(rawContact)) {
      return tone === 'compact' ? `Hallo ${rawContact},` : `Guten Tag ${rawContact},`;
    }
    if (/\bFrau\b/i.test(rawContact)) {
      return tone === 'compact' ? `Hallo ${rawContact},` : `Guten Tag ${rawContact},`;
    }
    // Single first or last name
    if (tone === 'compact') {
      return `Hallo ${rawContact},`;
    }
    if (tone === 'formal') {
      return `Sehr geehrte(r) ${rawContact},`;
    }
    return variant % 2 === 0 ? `Guten Tag ${rawContact},` : `Hallo ${rawContact},`;
  }

  // Generic / company / unknown landlord
  if (tone === 'formal') {
    return 'Sehr geehrte Damen und Herren,';
  }
  if (tone === 'compact') {
    return variant % 2 === 0 ? 'Guten Tag,' : 'Hallo,';
  }
  if (tone === 'warm') {
    return variant % 2 === 0 ? 'Guten Tag,' : 'Hallo,';
  }
  // tone === 'natural'
  return variant % 2 === 0 ? 'Guten Tag,' : 'Hallo,';
}

export function generateApplicationLetter(opts: LetterOptions): string {
  const {
    listing,
    rule,
    bgSize,
    benefitType,
    applicantName = '',
    phone = '',
    moveInDate = 'ab sofort / nach Absprache',
    personalNote = bgSize === 1
      ? 'ruhige, zuverlässige Einzelperson, Nichtraucher, keine Haustiere'
      : `ruhiger ${bgSize}-Personen-Haushalt, zuverlässig und ordentlich`,
    emphasizeDirectTransfer = true,
    addressSchufaDirectly = true,
    tone = 'natural',
    variantIndex = 0,
  } = opts;

  const v = Math.abs(variantIndex) % 3;
  const nameLine = applicantName.trim() || '[Ihr Name]';
  const phoneLine = phone.trim() ? `\nTelefon: ${phone.trim()}` : '';

  const locationPart = listing.district
    ? `${listing.city}-${listing.district}`
    : listing.city;

  const authorityName =
    benefitType === 'sgb12'
      ? `Sozialamt ${listing.city} (SGB XII)`
      : `Jobcenter ${listing.city} (SGB II)`;

  const legalRef = benefitType === 'sgb12' ? '§ 35 Abs. 1 SGB XII' : '§ 22 Abs. 7 SGB II';
  const salutation = resolveSalutation(listing, tone, v);
  const sizeNote = listing.sqm ? ` (${listing.sqm} m²)` : '';
  const rentVal = formatEur(listing.calculated_bruttokalt);

  // -------------------------------------------------------------
  // TONE 1: NATURAL (Freundlich, bodenständig, menschlich)
  // -------------------------------------------------------------
  if (tone === 'natural') {
    const openings = [
      `ich habe Ihre Anzeige für die Wohnung in ${locationPart}${sizeNote} gesehen und interessiere mich sehr dafür.`,
      `ich bin auf Ihr Wohnungsangebot in ${locationPart}${sizeNote} aufmerksam geworden – die Wohnung passt wirklich gut zu dem, was ich suche.`,
      `ich schreibe Ihnen bezüglich Ihrer Wohnung in ${locationPart}${sizeNote}, da mir das Inserat direkt sympathisch aufgefallen ist.`,
    ];

    const intros = [
      `Kurz zu meiner Person: ${personalNote}. Zeitlich wäre ein Einzug ${moveInDate} für mich ideal.`,
      `Ein paar Eckdaten zu mir: ${personalNote}. Einziehen könnte ich ${moveInDate}.`,
      `Zu meiner Situation: ${personalNote}. Als Einzugstermin wäre ${moveInDate} perfekt.`,
    ];

    let financeBlock: string;
    if (listing.compliance_status === 'tolerance') {
      financeBlock = `Bezüglich der Miete: Die Bruttokaltmiete von ${rentVal} liegt nahezu punktgenau im offiziellen Richtwert der Stadt ${listing.city} (${formatEur(rule.max_bruttokalt_eur)}). Einen eventuellen kleinen Differenzbetrag von ${formatEur(listing.eigenanteil_eur)} übernehme ich selbstverständlich zuverlässig selbst.`;
    } else {
      const fVariants = [
        `Finanziell ist alles vorab geklärt: Die Bruttokaltmiete von ${rentVal} liegt voll im Rahmen der Kostenübernahme durch das ${authorityName}. Die Kostenübernahme ist damit vollständig gesichert.`,
        `Bezüglich der Mietkosten besteht volle Klarheit: Mit ${rentVal} Bruttokaltmiete liegt die Wohnung genau innerhalb der Richtwerte der Stadt ${listing.city}. Die Miete wird zu 100 % vom ${authorityName} übernommen.`,
        `Die Mietzahlung ist zuverlässig geregelt: Die Kosten von ${rentVal} entsprechen exakt den Angemessenheitsgrenzen des ${authorityName} für ${bgSize} ${bgSize === 1 ? 'Person' : 'Personen'}.`,
      ];
      financeBlock = fVariants[v];
    }

    let directBlock = '';
    if (emphasizeDirectTransfer) {
      const dVariants = [
        `\n\nDamit Sie als Vermieter maximale Sicherheit haben, veranlasse ich auf Wunsch gerne eine Direktüberweisung (${legalRef}): Das Amt überweist die Miete dann jeden Monat pünktlich und direkt auf Ihr Vermieterkonto.`,
        `\n\nFür Ihre Planungssicherheit können wir unkompliziert vereinbaren, dass das ${authorityName} die Miete automatisch jeden Monat direkt an Sie überweist – so haben Sie keinerlei Ausfallrisiko.`,
        `\n\nAuf Ihren Wunsch hin kann die monatliche Miete auch direkt per behördlicher Direktabtretung auf Ihr Konto gezahlt werden – garantiert pünktlich zum Monatsanfang.`,
      ];
      directBlock = dVariants[v];
    }

    let schufaBlock = '';
    if (addressSchufaDirectly) {
      const sVariants = [
        `\n\nEin ehrlicher Hinweis vorab: Aus früheren Zeiten existiert bei mir noch ein älterer Schufa-Eintrag. Gerade deshalb ist mir die Direktzahlung durch das Amt wichtig – für Sie besteht dadurch kein finanzielles Risiko.`,
        `\n\nOffenheit ist mir wichtig: In meiner Schufa gibt es eine Altlast aus der Vergangenheit. Da die Miete aber verbindlich und auf Wunsch direkt von der Behörde gezahlt wird, ist die Zahlung für Sie zu 100 % garantiert.`,
        `\n\nZur Schufa möchte ich von vornherein transparent sein: Es gibt dort noch einen alten Vermerk. Dank der gesicherten Kostenübernahme und der Direktzahlung an Sie sind Sie als Vermieter aber vollkommen abgesichert.`,
      ];
      schufaBlock = sVariants[v];
    }

    const closings = [
      `Alle Unterlagen (Mietbescheinigung zur Unterschrift, Ausweis usw.) bringe ich gerne direkt zum Termin mit.\n\nWäre in den nächsten Tagen eine kurze Besichtigung möglich? Über eine Rückmeldung freue ich mich sehr.\n\nViele Grüße,\n${nameLine}${phoneLine}`,
      `Die erforderliche Mietbescheinigung für das Amt und meinen Ausweis habe ich vorbereitet.\n\nIch würde mich sehr freuen, wenn wir einen Besichtigungstermin vereinbaren könnten.\n\nBeste Grüße,\n${nameLine}${phoneLine}`,
      `Sämtliche Unterlagen für eine schnelle Abwicklung liegen bereit.\n\nÜber die Gelegenheit, die Wohnung persönlich anzuschauen, würde ich mich sehr freuen.\n\nHerzliche Grüße,\n${nameLine}${phoneLine}`,
    ];

    return `${salutation}\n\n${openings[v]}\n\n${intros[v]}\n\n${financeBlock}${directBlock}${schufaBlock}\n\n${closings[v]}`;
  }

  // -------------------------------------------------------------
  // TONE 2: COMPACT (Kurz & knackig für Chat / Kleinanzeigen)
  // -------------------------------------------------------------
  if (tone === 'compact') {
    let directNote = '';
    if (emphasizeDirectTransfer) {
      directNote = ' Gerne veranlasse ich die direkte Mietüberweisung vom Amt auf Ihr Konto.';
    }
    let schufaNote = '';
    if (addressSchufaDirectly) {
      schufaNote = ' (Zur Info: Älterer Schufa-Eintrag vorhanden, durch die Amtsübernahme aber absolut sicher).';
    }

    if (v === 0) {
      return `${salutation}

ist die Wohnung in ${locationPart}${sizeNote} noch verfügbar? Ich suche ab ${moveInDate} ein passendes Zuhause.

Kurz zu mir: ${personalNote}.
Die Miete (${rentVal}) liegt 100 % im offiziellen Rahmen des ${authorityName} und wird sicher übernommen.${directNote}${schufaNote}

Unterlagen habe ich griffbereit. Wäre eine Besichtigung möglich?

Viele Grüße,
${nameLine}${phoneLine}`;
    }

    if (v === 1) {
      return `${salutation}

ich interessiere mich für Ihr Wohnungsangebot in ${locationPart} und könnte ${moveInDate} einziehen.

Eckdaten: ${personalNote}.
Die Kostenübernahme durch das ${authorityName} ist sichergestellt (Miete ${rentVal} entspricht exakt den Richtwerten).${directNote}${schufaNote}

Wann würde Ihnen ein kurzer Besichtigungstermin passen?

Beste Grüße,
${nameLine}${phoneLine}`;
    }

    return `${salutation}

ich habe großes Interesse an Ihrer Wohnung in ${locationPart}${sizeNote}.

Zu mir: ${personalNote}, möglicher Einzug ${moveInDate}.
Die Miete (${rentVal}) ist durch das ${authorityName} voll abgedeckt.${directNote}${schufaNote}

Über eine kurze Rückmeldung zur Besichtigung würde ich mich freuen!

Freundliche Grüße,
${nameLine}${phoneLine}`;
  }

  // -------------------------------------------------------------
  // TONE 3: FORMAL (Sachlich, strukturiert, für Hausverwaltungen)
  // -------------------------------------------------------------
  if (tone === 'formal') {
    let directTransferItem = '';
    if (emphasizeDirectTransfer) {
      directTransferItem = `\n- Mietzahlung: Auf Wunsch direkte Anweisung der monatlichen Miete durch das Amt an Ihr Vermieterkonto (${legalRef}) zur vollständigen Absicherung.`;
    }

    let schufaItem = '';
    if (addressSchufaDirectly) {
      schufaItem = `\n- Bonitätshinweis: Transparenter Hinweis auf einen älteren Schufa-Eintrag; aufgrund der behördlichen Kostenübernahme und Direktzahlung besteht keinerlei Zahlungsausfallrisiko.`;
    }

    const titleRef = listing.title ? ` „${listing.title}“` : '';

    return `${salutation}

bezugnehmend auf Ihr Wohnungsangebot${titleRef} in ${locationPart}${sizeNote} bewerbe ich mich hiermit um diese Mietwohnung.

Wesentliche Rahmendaten:
- Mietinteressent: ${personalNote}
- Gewünschter Einzugstermin: ${moveInDate}
- Mietkostenübernahme: Die monatliche Bruttokaltmiete von ${rentVal} liegt innerhalb der offiziellen Angemessenheitsgrenze der Stadt ${listing.city} (${formatEur(rule.max_bruttokalt_eur)} für ${bgSize} ${bgSize === 1 ? 'Person' : 'Personen'}). Die Kostenübernahme durch das ${authorityName} ist gewährleistet.${directTransferItem}${schufaItem}
- Unterlagen: Sämtliche Nachweise (Mietbescheinigung, Personalausweis) liegen vor und werden zur Besichtigung mitgebracht.

Für Rückfragen stehe ich Ihnen gerne zur Verfügung und freue mich über eine Einladung zu einem Besichtigungstermin.

Mit freundlichen Grüßen,
${nameLine}${phoneLine}`;
  }

  // -------------------------------------------------------------
  // TONE 4: WARM (Sympathisch, familiär, Paare & Familien)
  // -------------------------------------------------------------
  const warmOpenings = [
    `wir haben Ihre Wohnungsanzeige für die Wohnung in ${locationPart}${sizeNote} entdeckt und finden sie wirklich sehr ansprechend.`,
    `über Ihr Inserat für die Wohnung in ${locationPart}${sizeNote} haben wir uns sehr gefreut – die Aufteilung passt hervorragend zu unserem Haushalt.`,
    `wir schreiben Ihnen mit großem Interesse an der Wohnung in ${locationPart}${sizeNote}, da wir uns dort ein schönes und langfristiges Zuhause vorstellen können.`,
  ];

  let warmDirect = '';
  if (emphasizeDirectTransfer) {
    warmDirect = `\n\nDamit die Zahlung für Sie von Anfang an vollkommen verlässlich läuft, veranlassen wir auf Ihren Wunsch gerne die direkte monatliche Mietüberweisung vom ${authorityName} an Sie.`;
  }

  let warmSchufa = '';
  if (addressSchufaDirectly) {
    warmSchufa = `\n\nZur Transparenz möchten wir vorab erwähnen, dass aus früheren Zeiten noch ein Schufa-Vermerk vorliegt. Durch die feste Kostenübernahme der Behörde ist die Miete für Sie aber zu 100 % gesichert.`;
  }

  const warmClosings = [
    `Alle erforderlichen Unterlagen bringen wir gerne direkt zur Besichtigung mit.\n\nÜber die Gelegenheit, uns persönlich bei einem Termin vorzustellen, würden wir uns von Herzen freuen!\n\nHerzliche Grüße,\n${nameLine}${phoneLine}`,
    `Die Mietbescheinigung für das Amt bringen wir gerne vorbereitet mit.\n\nWir würden uns sehr über eine Einladung zur Wohnungsbesichtigung freuen.\n\nBeste Grüße,\n${nameLine}${phoneLine}`,
    `Wir freuen uns auf Ihre Rückmeldung und die Chance, die Wohnung bald kennenzulernen.\n\nViele herzliche Grüße,\n${nameLine}${phoneLine}`,
  ];

  return `${salutation}

${warmOpenings[v]}

Wir sind ein ${personalNote} und suchen ab ${moveInDate} ein verlässliches, gepflegtes Zuhause.

Die Finanzierung ist vorab genau geprüft: Die Miete von ${rentVal} entspricht den Richtlinien der Stadt ${listing.city} und wird zuverlässig vom ${authorityName} getragen.${warmDirect}${warmSchufa}

${warmClosings[v]}`;
}
