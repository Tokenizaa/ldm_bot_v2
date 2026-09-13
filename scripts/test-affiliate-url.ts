import 'dotenv/config';
import assert from 'node:assert/strict';
import {
  AFFILIATE_GLOBAL_CODE,
  AFFILIATE_ID,
  buildAffiliateUrl,
  normalizeProductUrl,
} from '../server/utils/affiliate.js';

const base = 'https://www.lojadomecanico.com.br/produto/183851/21/223/parafusadeira-furadeira-de-impacto-brushless-12-pol-20v-com-2-baterias-carregador-e-maleta-dewalt-dcd7781d2-br';
const officialUtm = `${base}/${AFFILIATE_ID}?utm_campaign=afiliado-${AFFILIATE_GLOBAL_CODE}&utm_source=afiliado&utm_medium=site`;
const expected = `${base}/${AFFILIATE_ID}?afiliado=${AFFILIATE_GLOBAL_CODE}`;

assert.equal(normalizeProductUrl(`${base}/${AFFILIATE_ID}`), base);
assert.equal(normalizeProductUrl(officialUtm), base);
assert.equal(buildAffiliateUrl(base), expected);
assert.equal(buildAffiliateUrl(`${base}/${AFFILIATE_ID}`), expected);
assert.equal(buildAffiliateUrl(officialUtm), expected);
assert.equal(buildAffiliateUrl(expected), expected);
assert.equal(buildAffiliateUrl(buildAffiliateUrl(officialUtm)), expected);
assert.equal((expected.match(/\/20889/g) || []).length, 1);
assert.equal((expected.match(/\?afiliado=/g) || []).length, 1);
assert.ok(!expected.includes('utm_campaign='));
assert.ok(!expected.includes('utm_source='));
assert.ok(!expected.includes('utm_medium='));

console.log(JSON.stringify({
  success: true,
  affiliateId: AFFILIATE_ID,
  globalCode: AFFILIATE_GLOBAL_CODE,
  expected,
  assertions: 10,
}, null, 2));
