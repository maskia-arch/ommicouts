import test from 'node:test';
import assert from 'node:assert/strict';
import * as cheerio from 'cheerio';
import {
  classifyLandlord,
  normalizePhoneDigits,
} from '../src/services/landlordClassifier.js';
import { parseWohnungsaushangTable } from '../src/scraper/parser.js';

test('normalizePhoneDigits normalizes German phone numbers cleanly', () => {
  assert.equal(normalizePhoneDigits('+49 (209) 50808200'), '020950808200');
  assert.equal(normalizePhoneDigits('0209 / 508082-00'), '020950808200');
  assert.equal(normalizePhoneDigits('+49 209 17003-28547'), '02091700328547');
  assert.equal(normalizePhoneDigits('0049 211 7407400'), '02117407400');
  assert.equal(normalizePhoneDigits('0172 1234567'), '01721234567');
});

test('classifyLandlord identifies Trah Hausverwaltung via phone, email, and keywords', () => {
  const byPhone = classifyLandlord({ phone: '+49 (209) 50808200' });
  assert.equal(byPhone.isCommercial, true);
  assert.equal(byPhone.isPrivate, false);
  assert.equal(byPhone.commercialName, 'Trah Hausverwaltung');

  const byEmail = classifyLandlord({ email: 'vermietung@trah.eu' });
  assert.equal(byEmail.isCommercial, true);
  assert.equal(byEmail.commercialName, 'Trah Hausverwaltung');

  const byKeyword = classifyLandlord({ sellerName: 'Immobilienverwaltung Trah' });
  assert.equal(byKeyword.isCommercial, true);
  assert.equal(byKeyword.commercialName, 'Trah Hausverwaltung');
});

test('classifyLandlord identifies Vivawest, LEG, GGW, Vonovia, WBG Horst', () => {
  const vivawest = classifyLandlord({ phone: '0209 17003-13360' });
  assert.equal(vivawest.isCommercial, true);
  assert.equal(vivawest.commercialName, 'Vivawest Wohnen GmbH');

  const leg = classifyLandlord({ phone: '0211 740 70 99 90' });
  assert.equal(leg.isCommercial, true);
  assert.equal(leg.commercialName, 'LEG Wohnen NRW');

  const ggw = classifyLandlord({ phone: '+49-209-7060' });
  assert.equal(ggw.isCommercial, true);
  assert.equal(ggw.commercialName, 'GGW Gelsenkirchen');

  const horst = classifyLandlord({ phone: '+49 (209) 55548' });
  assert.equal(horst.isCommercial, true);
  assert.equal(horst.commercialName, 'Wohnungsbaugenossenschaft Horst eG (WBG Horst)');

  const vonovia = classifyLandlord({ phone: '0342580004' });
  assert.equal(vonovia.isCommercial, true);
  assert.equal(vonovia.commercialName, 'Vonovia SE');
});

test('classifyLandlord detects general commercial keywords in seller name & text', () => {
  const gmbh = classifyLandlord({ sellerName: 'Müller Hausverwaltung GmbH' });
  assert.equal(gmbh.isCommercial, true);
  assert.equal(gmbh.isPrivate, false);

  const makler = classifyLandlord({ fullText: 'Vermittlung durch Maklerbüro Schmidt' });
  assert.equal(makler.isCommercial, true);
  assert.equal(makler.isPrivate, false);
});

test('classifyLandlord preserves true private individuals', () => {
  const privPerson = classifyLandlord({
    sellerName: 'Familie Schmidt',
    phone: '0172 9876543',
    portal: 'kleinanzeigen',
  });
  assert.equal(privPerson.isCommercial, false);
  assert.equal(privPerson.isPrivate, true);
});

test('parseWohnungsaushangTable correctly labels Trah Hausverwaltung rows as commercial and not private', () => {
  const html = `
    <html>
      <body>
        <table id="contentContentPlaceHolder_spalte_links_ctl00_wohnungenGridView">
          <tr>
            <th>Räume</th>
            <th>Größe</th>
            <th>Miete</th>
            <th>Adresse</th>
            <th>Telefon</th>
          </tr>
          <tr>
            <td>2,0</td>
            <td>48,79 m²</td>
            <td>415,37 €</td>
            <td>Ückendorf, Heidelberger Str. 9</td>
            <td>+49 (209) 50808200</td>
          </tr>
          <tr>
            <td>3,0</td>
            <td>65,00 m²</td>
            <td>450,00 €</td>
            <td>Buer, Horster Str. 12</td>
            <td>0172 9988776</td>
          </tr>
        </table>
      </body>
    </html>
  `;

  const $ = cheerio.load(html);
  const candidates = parseWohnungsaushangTable(
    $,
    'https://www.gelsenkirchen.de/de/infrastruktur/bauen_und_wohnen/wohnungsaushang.aspx',
    'Gelsenkirchen'
  );

  assert.equal(candidates.length, 2);

  const [trahRow, privateRow] = candidates;
  // Trah row: MUST be commercial, is_private_landlord = false, contact_name = Trah Hausverwaltung
  assert.equal(trahRow.serpParsed.is_private_landlord, false);
  assert.equal(trahRow.serpParsed.contact_name, 'Trah Hausverwaltung');
  assert.equal(trahRow.serpParsed.contact_phone, '+49 (209) 50808200');

  // Private row: single private mobile number
  assert.equal(privateRow.serpParsed.is_private_landlord, true);
  assert.equal(privateRow.serpParsed.contact_name, 'Vermieter (Wohnungsaushang)');
});
