import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeBruttokalt,
  findMatchedMinBgSize,
  resolveRuleForBgSize,
} from '../src/services/kduMatcher.js';

const GE_RULES = [
  { city: 'Gelsenkirchen', bg_size: 1, max_sqm: 50, max_bruttokalt_eur: 367.5, extra_person_sqm: 15, extra_person_eur: 116.6 },
  { city: 'Gelsenkirchen', bg_size: 2, max_sqm: 65, max_bruttokalt_eur: 466.7, extra_person_sqm: 15, extra_person_eur: 116.6 },
  { city: 'Gelsenkirchen', bg_size: 3, max_sqm: 80, max_bruttokalt_eur: 579.2, extra_person_sqm: 15, extra_person_eur: 116.6 },
  { city: 'Gelsenkirchen', bg_size: 4, max_sqm: 95, max_bruttokalt_eur: 694.45, extra_person_sqm: 15, extra_person_eur: 116.6 },
  { city: 'Gelsenkirchen', bg_size: 5, max_sqm: 110, max_bruttokalt_eur: 841.5, extra_person_sqm: 15, extra_person_eur: 116.6 },
  { city: 'Gelsenkirchen', bg_size: 6, max_sqm: 125, max_bruttokalt_eur: 958.1, extra_person_sqm: 15, extra_person_eur: 116.6 },
];

test('computeBruttokalt sums cold rent and additional costs without heating', () => {
  assert.equal(computeBruttokalt(280, 87.5), 367.5);
  assert.equal(computeBruttokalt(300, null), 300);
  assert.equal(computeBruttokalt(null, 80), null);
});

test('resolveRuleForBgSize extrapolates 7+ persons accurately', () => {
  const r7 = resolveRuleForBgSize(GE_RULES, 7);
  assert.equal(r7.max_sqm, 140);
  assert.equal(r7.max_bruttokalt_eur, 1074.7);
  assert.equal(r7.is_extrapolated, true);
});

test('findMatchedMinBgSize finds smallest matching BG size per Produkttheorie', () => {
  assert.equal(findMatchedMinBgSize(367.5, GE_RULES), 1);
  assert.equal(findMatchedMinBgSize(368.0, GE_RULES), 2);
  assert.equal(findMatchedMinBgSize(466.7, GE_RULES), 2);
  assert.equal(findMatchedMinBgSize(579.2, GE_RULES), 3);
  assert.equal(findMatchedMinBgSize(694.45, GE_RULES), 4);
  assert.equal(findMatchedMinBgSize(841.5, GE_RULES), 5);
  assert.equal(findMatchedMinBgSize(958.1, GE_RULES), 6);
  assert.equal(findMatchedMinBgSize(1000.0, GE_RULES), 7);
});
