import PDFDocument from 'pdfkit';

function formatEur(val) {
  if (val === null || val === undefined || Number.isNaN(Number(val))) return '–';
  return `${Number(val).toFixed(2).replace('.', ',')} €`;
}

function formatPortal(portal) {
  switch (portal) {
    case 'kleinanzeigen':
      return 'Kleinanzeigen';
    case 'immowelt':
      return 'Immowelt';
    case 'immoscout':
      return 'ImmoScout24';
    default:
      return 'Portal';
  }
}

async function resolveLogoBuffer(logoUrl) {
  const src = String(logoUrl || '').trim();
  if (!src) return null;

  if (/^data:image\/(png|jpe?g);base64,/i.test(src)) {
    const b64 = src.split(',')[1] || '';
    const buf = Buffer.from(b64, 'base64');
    if (buf.length > 0 && buf.length <= 600 * 1024) {
      return buf;
    }
    return null;
  }

  if (/^https:\/\//i.test(src)) {
    try {
      const res = await fetch(src, {
        signal: AbortSignal.timeout(3500),
        headers: { accept: 'image/png,image/jpeg,image/*' },
      });
      if (!res.ok) return null;
      const ctype = String(res.headers.get('content-type') || '').toLowerCase();
      if (!ctype.includes('image/png') && !ctype.includes('image/jpeg') && !ctype.includes('image/jpg')) {
        return null;
      }
      const arr = await res.arrayBuffer();
      const buf = Buffer.from(arr);
      if (buf.length > 0 && buf.length <= 1024 * 1024) {
        return buf;
      }
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Generates an A4 Landscape printable Wohnungsliste PDF buffer with organization branding,
 * KdU filter summary, direct contact fields (phone/email/name), and offline work checkboxes.
 */
export async function buildHousingListPdfBuffer({
  organization = {},
  filters = {},
  rule = {},
  listings = [],
}) {
  const logoBuffer = await resolveLogoBuffer(organization.org_logo_url);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margin: 28,
      bufferPages: true,
      info: {
        Title: `Wohnungsliste - ${filters.city || 'Gelsenkirchen'}`,
        Author: organization.org_name || 'Jobcenter-Wohnungs-Matcher',
      },
    });

    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    const pageW = doc.page.width - doc.page.margins.left - doc.page.margins.right; // ~785pt
    const startX = doc.page.margins.left;
    const bottomLimit = doc.page.height - doc.page.margins.bottom - 26;

    // Column geometry summing cleanly to 785pt
    const cols = [
      { key: 'nr', label: '#', width: 24 },
      { key: 'title', label: 'Wohnungsangebot & Adresse / Link', width: 206 },
      { key: 'specs', label: 'Größe / Zi. / WBS', width: 88 },
      { key: 'rent', label: 'Miete (Bruttokalt)', width: 112 },
      { key: 'contact', label: 'Direkter Kontakt (Tel. / E-Mail)', width: 195 },
      { key: 'offline', label: 'Offline-Bearbeitung', width: pageW - 24 - 206 - 88 - 112 - 195 }, // 160pt
    ];

    const drawHeader = () => {
      const topY = doc.y;
      let textLeft = startX;

      if (logoBuffer) {
        try {
          doc.image(logoBuffer, startX, topY, { fit: [64, 44], valign: 'center' });
          textLeft = startX + 74;
        } catch {
          textLeft = startX;
        }
      }

      const orgTitle = organization.org_name || 'Organisations-Wohnungsliste';
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(15).text(orgTitle, textLeft, topY, {
        width: 470,
      });

      const subParts = [];
      if (organization.org_subtitle) subParts.push(organization.org_subtitle);
      if (organization.org_contact) subParts.push(organization.org_contact);
      if (subParts.length > 0) {
        doc.fillColor('#475569').font('Helvetica').fontSize(8.5).text(subParts.join('  ·  '), textLeft, doc.y + 1, {
          width: 470,
        });
      }

      const generatedAt = new Date().toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });

      doc
        .fillColor('#0f172a')
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(`Wohnungsliste ${filters.city || 'Gelsenkirchen'}`, startX + pageW - 235, topY, {
          width: 235,
          align: 'right',
        });

      doc
        .fillColor('#475569')
        .font('Helvetica')
        .fontSize(8)
        .text(
          `Stand: ${generatedAt}  ·  Treffer: ${listings.length}`,
          startX + pageW - 235,
          topY + 15,
          { width: 235, align: 'right' }
        );

      const metaY = Math.max(doc.y, topY + 46) + 4;
      doc
        .roundedRect(startX, metaY, pageW, 22, 4)
        .fillAndStroke('#f1f5f9', '#cbd5e1');

      const summaryParts = [
        `Bereich: ${filters.city || 'Gelsenkirchen'}${filters.district && filters.district !== 'all' ? ` (${filters.district})` : ' (Alle Stadtteile)'}`,
        `Haushalt: ${filters.bg_size || 1} Pers. (${filters.benefit_type === 'sgb12' ? 'SGB XII' : 'SGB II'})`,
        `Max. Bruttokalt: ${formatEur(filters.max_bruttokalt_eur ?? rule.max_bruttokalt_eur)}`,
        filters.private_only ? 'Nur Privatvermieter' : 'Alle Anbieter',
        filters.require_direct_contact ? 'Nur mit Tel./E-Mail' : 'Alle Kontaktarten',
      ];
      doc
        .fillColor('#1e293b')
        .font('Helvetica')
        .fontSize(8)
        .text(summaryParts.join('   |   '), startX + 8, metaY + 7, { width: pageW - 16 });

      doc.y = metaY + 30;
    };

    const drawTableHeader = () => {
      const y = doc.y;
      doc.rect(startX, y, pageW, 20).fill('#0f172a');
      let x = startX;
      doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(8);
      for (const col of cols) {
        doc.text(col.label, x + 5, y + 6, { width: col.width - 10, ellipsis: true });
        x += col.width;
      }
      doc.y = y + 20;
    };

    drawHeader();
    drawTableHeader();

    if (listings.length === 0) {
      doc
        .fillColor('#475569')
        .font('Helvetica')
        .fontSize(10)
        .text(
          'Keine aktiven Wohnungsangebote für die gewählten Filterkriterien gefunden.',
          startX,
          doc.y + 18
        );
    }

    listings.forEach((item, index) => {
      const titleText = `${item.title || 'Wohnungsangebot'}`;
      const locText = `${item.zipcode ? `${item.zipcode} ` : ''}${item.district || item.city || ''}`;
      const urlShort = String(item.url || '').slice(0, 72) + (String(item.url || '').length > 72 ? '...' : '');
      const col1Text = `${titleText}\n${locText} · ${formatPortal(item.portal)}\n${urlShort}`;

      const specText = [
        item.sqm ? `${item.sqm} m²` : '– m²',
        item.rooms ? `${item.rooms} Zi.` : '– Zi.',
        item.wbs_required ? 'WBS nötig' : 'Ohne WBS',
        item.is_private_landlord ? 'Privatvermieter' : 'Gewerblich/Genoss.',
      ].join('\n');

      const rentText = [
        `${formatEur(item.calculated_bruttokalt)} Brutto`,
        `Kalt: ${formatEur(item.cold_rent)}`,
        `NK: ${formatEur(item.additional_costs)}`,
        item.heating_costs > 0 ? `Hzg: ${formatEur(item.heating_costs)}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const contactLines = [];
      if (item.contact_name) contactLines.push(`Name: ${item.contact_name}`);
      if (item.contact_phone) contactLines.push(`Tel.: ${item.contact_phone}`);
      if (item.contact_email) contactLines.push(`Mail: ${item.contact_email}`);
      if (contactLines.length === 0) {
        contactLines.push('Kein Direktkontakt im Inserat');
      }
      const contactText = contactLines.join('\n');

      const offlineText = '[ ] Kontaktiert  [ ] Termin\n[ ] Abgelehnt   [ ] Zusage\nNotiz: ___________________';

      doc.font('Helvetica').fontSize(7.8);
      const h1 = doc.heightOfString(col1Text, { width: cols[1].width - 10 });
      const h2 = doc.heightOfString(specText, { width: cols[2].width - 10 });
      const h3 = doc.heightOfString(rentText, { width: cols[3].width - 10 });
      const h4 = doc.heightOfString(contactText, { width: cols[4].width - 10 });
      const h5 = doc.heightOfString(offlineText, { width: cols[5].width - 10 });
      const rowHeight = Math.max(46, Math.ceil(Math.max(h1, h2, h3, h4, h5)) + 12);

      if (doc.y + rowHeight > bottomLimit) {
        doc.addPage();
        drawTableHeader();
      }

      const rowY = doc.y;
      const bg = index % 2 === 1 ? '#f8fafc' : '#ffffff';
      doc.rect(startX, rowY, pageW, rowHeight).fillAndStroke(bg, '#e2e8f0');

      let x = startX;
      // Col 0: #
      doc.fillColor('#334155').font('Helvetica-Bold').fontSize(8);
      doc.text(String(index + 1), x + 5, rowY + 6, { width: cols[0].width - 10 });
      x += cols[0].width;

      // Col 1: Title + Loc + URL
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8);
      doc.text(titleText, x + 5, rowY + 6, { width: cols[1].width - 10, height: 22, ellipsis: true });
      doc.fillColor('#334155').font('Helvetica').fontSize(7.5);
      doc.text(`${locText} · ${formatPortal(item.portal)}\n${urlShort}`, x + 5, doc.y + 1, {
        width: cols[1].width - 10,
      });
      x += cols[1].width;

      // Col 2: Specs
      doc.fillColor('#1e293b').font('Helvetica').fontSize(7.8);
      doc.text(specText, x + 5, rowY + 6, { width: cols[2].width - 10 });
      x += cols[2].width;

      // Col 3: Rent
      doc.fillColor('#0f172a').font('Helvetica-Bold').fontSize(8);
      doc.text(`${formatEur(item.calculated_bruttokalt)} Brutto`, x + 5, rowY + 6, {
        width: cols[3].width - 10,
      });
      doc.fillColor('#334155').font('Helvetica').fontSize(7.5);
      doc.text(
        [`Kalt: ${formatEur(item.cold_rent)}`, `NK: ${formatEur(item.additional_costs)}`, item.heating_costs > 0 ? `Hzg: ${formatEur(item.heating_costs)}` : '']
          .filter(Boolean)
          .join('\n'),
        x + 5,
        doc.y + 1,
        { width: cols[3].width - 10 }
      );
      x += cols[3].width;

      // Col 4: Direct Contact
      doc.fillColor(item.contact_phone || item.contact_email ? '#065f46' : '#64748b')
        .font(item.contact_phone || item.contact_email ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(7.8);
      doc.text(contactText, x + 5, rowY + 6, { width: cols[4].width - 10 });
      x += cols[4].width;

      // Col 5: Offline Checklist
      doc.fillColor('#334155').font('Helvetica').fontSize(7.6);
      doc.text(offlineText, x + 5, rowY + 6, { width: cols[5].width - 10 });

      doc.y = rowY + rowHeight;
    });

    // Add page footers on every page
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const footerY = doc.page.height - doc.page.margins.bottom - 14;
      doc
        .fillColor('#64748b')
        .font('Helvetica')
        .fontSize(7.5)
        .text(
          `Offline-Arbeitsliste · Hinweis: Alle KdU-Werte dienen als Orientierung vor schriftlicher Zusicherung durch Jobcenter/Sozialamt. · Seite ${i + 1} von ${range.count}`,
          startX,
          footerY,
          { width: pageW, align: 'center' }
        );
    }

    doc.end();
  });
}
