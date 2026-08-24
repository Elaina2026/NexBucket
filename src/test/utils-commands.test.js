import test from 'node:test';
import assert from 'node:assert/strict';
import { utilCommands, utilCommandNames } from '../utils/commands.js';

test('utility command routing uses every unique registered command name', () => {
  const names = utilCommands.map(command => command.name);
  assert.equal(utilCommandNames.size, names.length);
  assert.deepEqual([...utilCommandNames], names);
});

test('required slash command options precede optional options', () => {
  for (const command of utilCommands) {
    let optionalSeen = false;
    for (const option of command.options || []) {
      if (option.required === true) assert.equal(optionalSeen, false, `${command.name}.${option.name}`);
      else optionalSeen = true;
    }
  }
});
