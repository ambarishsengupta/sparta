import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const onnx = 'services/worker/models/garment-cnn-v1.onnx';
const card = 'ml/recommendation-engine/garment/model_card.md';

// LLD 7.7: CI fails if the committed ONNX file's SHA-256 differs from the model card.
describe('garment model card', () => {
  it('names the SHA-256 of the committed ONNX file', () => {
    expect(existsSync(onnx), `${onnx} is missing`).toBe(true);
    const lines = readFileSync(card, 'utf8').match(/^\*\*ONNX SHA-256:\*\* `([0-9a-f]{64})`/gm) ?? [];
    expect(lines, 'the card needs exactly one "ONNX SHA-256" line').toHaveLength(1);
    const stated = /`([0-9a-f]{64})`/.exec(lines[0] ?? '')?.[1];
    expect(stated).toBe(createHash('sha256').update(readFileSync(onnx)).digest('hex'));
  });

  it('says the team evaluation is not done and keeps the guess switch off', () => {
    const text = readFileSync(card, 'utf8');
    expect(text).toContain('is NOT done');
    expect(text).toContain('`GARMENT_GUESS_ENABLED` must stay false');
  });
});
