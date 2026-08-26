import { canAttemptDatabase, isDatabaseUnavailable } from '../database/client.js';

export function createBackgroundJob(label, task, options = {}) {
  const logError = options.logError || console.error;
  const usesDatabase = options.usesDatabase === true;
  let running = false;

  async function run() {
    if (running || (usesDatabase && !canAttemptDatabase())) return false;
    running = true;
    try {
      await task();
      return true;
    } catch (error) {
      if (!isDatabaseUnavailable(error)) logError(`[${label}] Background job failed:`, error);
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
