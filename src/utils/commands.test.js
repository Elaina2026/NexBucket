import test from 'node:test';
import assert from 'node:assert/strict';
import { utilCommands, utilCommandNames } from './commands.js';

test('utility command routing uses every unique registered command name', () => {
  const names = utilCommands.map(command => command.name);
  assert.equal(utilCommandNames.size, names.length);
  assert.deepEqual([...utilCommandNames], names);
  assert.ok(utilCommandNames.has('aimodel'));
});
