import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyDatabaseMigration,
  dryRunDatabaseMigration,
  verifyDatabaseMigration,
  withDatabaseClients,
} from './database.js';
import {
  applyObjectMigration,
  dryRunObjectMigration,
  verifyObjectMigration,
} from './objects.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const mode = process.argv[2];
const scope = process.argv[3] || 'all';
const allowedModes = new Set(['dry-run', 'apply', 'verify']);
const allowedScopes = new Set(['database', 'objects', 'all']);

if (!allowedModes.has(mode) || !allowedScopes.has(scope)) {
  console.error('Usage: npm run migrate:data -- <dry-run|apply|verify> [database|objects|all]');
  process.exitCode = 2;
} else {
  const report = {};
  try {
    if (scope === 'database' || scope === 'all') {
      report.database = await withDatabaseClients(async (source, target) => {
        if (mode === 'dry-run') return dryRunDatabaseMigration(source, target);
        if (mode === 'apply') return applyDatabaseMigration(source, target, { resume: true });
        return verifyDatabaseMigration(source, target);
      });
    }
    if (scope === 'objects' || scope === 'all') {
      if (mode === 'dry-run') report.objects = await dryRunObjectMigration();
      else if (mode === 'apply') report.objects = await applyObjectMigration();
      else report.objects = await verifyObjectMigration();
    }
    const outputPath = path.join(root, `migration-${mode}-report.json`);
    await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(`[Migration] ${mode} complete. Report: ${path.basename(outputPath)}`);
  } catch (error) {
    console.error(`[Migration] ${mode} failed: ${error.message}`);
    if (error.report) {
      const outputPath = path.join(root, `migration-${mode}-failure.json`);
      await fs.writeFile(outputPath, `${JSON.stringify(error.report, null, 2)}\n`, { mode: 0o600 });
      console.error(`[Migration] Failure report: ${path.basename(outputPath)}`);
    }
    process.exitCode = 1;
  }
}
