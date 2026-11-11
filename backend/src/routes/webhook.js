import { Router } from 'express';
import { requireWebhookSecret } from '../middleware/auth.js';
import { crawlSingleUrl } from '../scraper/engine.js';
import { sleepJitter } from '../scraper/httpClient.js';
import { extractUrlsFromWebhookPayload } from '../scraper/parser.js';

const router = Router();

router.post('/ingest', requireWebhookSecret, async (req, res) => {
  try {
    const city = String(req.body?.city || 'Gelsenkirchen').trim();
    const urls = extractUrlsFromWebhookPayload(req.body);

    if (urls.length === 0) {
      return res.status(400).json({
        ok: false,
        message: 'Keine unterstützten Immobilien-URLs im Webhook-Payload gefunden.',
        extracted: [],
      });
    }

    const results = [];
    for (let i = 0; i < urls.length; i++) {
      if (i > 0) {
        await sleepJitter(1500, 3500);
      }
      try {
        const crawled = await crawlSingleUrl(urls[i], {
          runType: 'webhook',
          city,
        });
        results.push({
          url: urls[i],
          ok: crawled.ok,
          external_id: crawled.listing?.external_id || null,
          reason: crawled.reason || null,
        });
      } catch (err) {
        results.push({
          url: urls[i],
          ok: false,
          error: err.message,
        });
      }
    }

    return res.json({
      ok: true,
      processed: results.length,
      results,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
