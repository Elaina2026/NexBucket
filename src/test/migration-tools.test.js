import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalInteger,
  canonicalJson,
  canonicalSourceRow,
  canonicalTargetRow,
  createRowHasher,
  targetInteger,
} from '../../scripts/migrate/canonical.js';
import { TABLE_BY_NAME, objectPublicUrl, rewriteLearnMedia } from '../../scripts/migrate/manifest.js';

const GUILD_ID = '12345678901234567';
const PNG_KEY = `${GUILD_ID}/123e4567-e89b-42d3-a456-426614174000.png`;
const WEBM_KEY = `${GUILD_ID}/223e4567-e89b-42d3-a456-426614174000.webm`;

test('migration canonical JSON sorts object keys and preserves array order', () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, x: 3 }, list: [2, 1] }), '{"a":{"x":3,"y":2},"list":[2,1],"z":1}');
  const left = createRowHasher();
  const right = createRowHasher();
  left.update({ b: 2, a: 1 });
  right.update({ a: 1, b: 2 });
  assert.deepEqual(left.digest(), right.digest());
});

test('migration converts PostgreSQL JSON, boolean, timestamp, and integers deterministically', () => {
  const definition = TABLE_BY_NAME.get('guild_config_history');
  const source = canonicalSourceRow({
    id: 9n,
    version: '2',
    previous_version: 1,
    rollback_from_id: null,
    changed_sections: ['ticket'],
    before_config: { ticket: {} },
    after_config: { ticket: { enabled: true } },
    created_at: new Date('2026-01-01T00:00:00Z'),
  }, definition);
  const target = canonicalTargetRow({
    id: 9n,
    version: 2n,
    previous_version: 1n,
    rollback_from_id: null,
    changed_sections: '["ticket"]',
    before_config: '{"ticket":{}}',
    after_config: '{"ticket":{"enabled":true}}',
    created_at: '2026-01-01T00:00:00.000Z',
  }, definition);
  assert.deepEqual(target, source);
  assert.equal(canonicalInteger(9n), '9');
  assert.equal(targetInteger('9'), 9n);
  assert.throws(() => targetInteger('9223372036854775808'), /64-bit/);
});

test('Learn migration rewrites legacy image fields and source URLs to local media', () => {
  const context = {
    sourceSupabaseUrl: 'https://project.example.co',
    sourceBucket: 'learn-images',
  };
  const rewritten = rewriteLearnMedia({
    triggers_json: {
      direct: { response: '', imagePath: PNG_KEY, imageUrl: 'https://old.invalid/a.png' },
      legacy: { response: '', imageUrl: `https://project.example.co/storage/v1/object/public/learn-images/${WEBM_KEY}` },
    },
  }, context);
  assert.deepEqual(rewritten.triggers_json.direct, {
    response: '', mediaPath: PNG_KEY, mediaUrl: `/media/${PNG_KEY}`, mediaType: 'image/png',
  });
  assert.deepEqual(rewritten.triggers_json.legacy, {
    response: '', mediaPath: WEBM_KEY, mediaUrl: `/media/${WEBM_KEY}`, mediaType: 'video/webm',
  });
  assert.equal(objectPublicUrl(PNG_KEY), `/media/${PNG_KEY}`);
  assert.throws(() => objectPublicUrl('../secret.png'), /Invalid local media key/);
  assert.throws(() => rewriteLearnMedia({
    triggers_json: { external: { imageUrl: 'https://unrelated.example/image.png' } },
  }, context), /Unmigratable Learn media URL/);
});
