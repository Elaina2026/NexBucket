import { getSupabaseBackoffDelay, isSupabaseUnavailable } from '../database/supabaseClient.js';

export function createBackgroundJob(label, task, options = {}) {
  const now = options.now || Date.now;
  const logError = options.logError || console.error;
  const unavailableLogIntervalMs = options.unavailableLogIntervalMs || 5 * 60 * 1000;
  let running = false;
  let unavailableFailures = 0;
  let nextUnavailableLogAt = 0;

  async function run() {
    if (running) return false;
    running = true;
    try {
      await task();
      if (unavailableFailures > 0) {
        logError(`[${label}] Supabase REST API recovered.`);
        unavailableFailures = 0;
        nextUnavailableLogAt = 0;
      }
      return true;
    } catch (error) {
      if (isSupabaseUnavailable(error)) {
        unavailableFailures++;
        const currentTime = now();
        if (currentTime >= nextUnavailableLogAt) {
          logError(`[${label}] Supabase REST API unavailable; retrying later:`, error?.message || error);
          nextUnavailableLogAt = currentTime + Math.max(
            unavailableLogIntervalMs,
            getSupabaseBackoffDelay(unavailableFailures),
          );
        }
      } else {
        logError(`[${label}] Background job failed:`, error);
      }
      return false;
    } finally {
      running = false;
    }
  }

  return {
    run,
    isRunning: () => running,
    getUnavailableFailures: () => unavailableFailures,
  };
}

export function scheduleBackgroundJob(label, task, intervalMs, options = {}) {
  const job = createBackgroundJob(label, task, options);
  const timer = setInterval(() => { job.run(); }, intervalMs);
  timer.unref?.();
  return { ...job, timer };
}
