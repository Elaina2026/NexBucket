import { canAttemptSupabase, isSupabaseUnavailable } from '../database/supabaseClient.js';

export function createBackgroundJob(label, task, options = {}) {
  const logError = options.logError || console.error;
  const usesSupabase = options.usesSupabase === true;
  let running = false;

  async function run() {
    if (running || (usesSupabase && !canAttemptSupabase())) return false;
    running = true;
    try {
      await task();
      return true;
    } catch (error) {
      if (!isSupabaseUnavailable(error)) logError(`[${label}] Background job failed:`, error);
      return false;
    } finally {
      running = false;
    }
  }

  return {
    run,
    isRunning: () => running,
  };
}

export function scheduleBackgroundJob(label, task, intervalMs, options = {}) {
  const job = createBackgroundJob(label, task, options);
  const timer = setInterval(() => { job.run(); }, intervalMs);
  timer.unref?.();
  return { ...job, timer };
}
