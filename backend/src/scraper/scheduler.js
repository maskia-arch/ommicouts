import cron from 'node-cron';
import { config } from '../config.js';
import { pool } from '../db.js';
import { getEngineStatus, runDeltaPoll, runReconciler } from './engine.js';
import { syncKduSourceForCity } from '../services/kduUpdater.js';

const scheduledTasks = [];
const deltaQueue = [];
const queuedConfigIds = new Set();
let drainingQueue = false;

async function drainDeltaQueue() {
  if (drainingQueue) return;
  drainingQueue = true;

  try {
    while (deltaQueue.length > 0) {
      while (getEngineStatus().deltaPollRunning) {
        await new Promise((r) => setTimeout(r, 3000));
      }

      const nextJob = deltaQueue.shift();
      if (!nextJob) continue;
      queuedConfigIds.delete(nextJob.configId);

      try {
        await runDeltaPoll({ configId: nextJob.configId });
      } catch (err) {
        console.error(`[Scheduler] Fehler bei Config #${nextJob.configId}:`, err.message);
      }

      if (deltaQueue.length > 0) {
        const pauseMs = 1500 + Math.floor(Math.random() * 2500);
        await new Promise((r) => setTimeout(r, pauseMs));
      }
    }
  } finally {
    drainingQueue = false;
    if (deltaQueue.length > 0) {
      void drainDeltaQueue();
    }
  }
}

export function enqueueScheduledDeltaPoll(configId) {
  if (!configId || queuedConfigIds.has(configId)) {
    return false;
  }
  queuedConfigIds.add(configId);
  deltaQueue.push({ configId });
  void drainDeltaQueue();
  return true;
}

export function stopAllSchedules() {
  while (scheduledTasks.length > 0) {
    const task = scheduledTasks.pop();
    try {
      task.stop();
    } catch {
      // ignore
    }
  }
  deltaQueue.length = 0;
  queuedConfigIds.clear();
}

export async function reloadSchedules() {
  stopAllSchedules();

  if (!config.enableCron) {
    console.log('[Scheduler] Cron-Jobs sind über ENABLE_CRON=false deaktiviert.');
    return;
  }

  const { rows: configs } = await pool.query(
    `SELECT id, name, cron_expression, is_active FROM scraper_configs WHERE is_active = TRUE ORDER BY id ASC`
  );

  for (const cfg of configs) {
    if (!cron.validate(cfg.cron_expression)) {
      console.warn(
        `[Scheduler] Ungültiger Cron-String "${cfg.cron_expression}" für Config #${cfg.id} (${cfg.name}).`
      );
      continue;
    }

    const task = cron.schedule(cfg.cron_expression, () => {
      enqueueScheduledDeltaPoll(cfg.id);
    });

    scheduledTasks.push(task);
  }

  // Phase B Reconciler daily at 03:17 CET/CEST
  const reconcileTask = cron.schedule('17 3 * * *', async () => {
    try {
      await runReconciler({ batchLimit: 100 });
    } catch (err) {
      console.error('[Scheduler] Fehler beim Reconciler:', err.message);
    }
  });
  scheduledTasks.push(reconcileTask);

  // Automatic 24h KdU-URL synchronization per configured city
  const { rows: kduSources } = await pool.query(
    `SELECT city, sync_cron FROM kdu_sources WHERE auto_sync_enabled = TRUE AND source_url IS NOT NULL AND source_url <> '' ORDER BY id ASC`
  );

  for (const src of kduSources) {
    const expr = src.sync_cron || '0 4 * * *';
    if (!cron.validate(expr)) {
      console.warn(`[Scheduler] Ungültiger KdU-Cron "${expr}" für Stadt "${src.city}".`);
      continue;
    }

    const kduTask = cron.schedule(expr, async () => {
      try {
        const res = await syncKduSourceForCity(src.city);
        console.log(`[Scheduler] KdU-Sync ${src.city}:`, JSON.stringify(res));
      } catch (err) {
        console.error(`[Scheduler] KdU-Sync Fehler (${src.city}):`, err.message);
      }
    });
    scheduledTasks.push(kduTask);
  }

  console.log(`[Scheduler] ${scheduledTasks.length} aktive Cron-Aufgaben geladen.`);
}
