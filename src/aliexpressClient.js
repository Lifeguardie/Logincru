const crypto = require('crypto');
const config = require('./config');

/**
 * Sign request params for the AliExpress open platform "sync" endpoint
 * (https://api-sg.aliexpress.com/sync): sort keys alphabetically, concatenate
 * key+value pairs, HMAC-SHA256 with the app secret, uppercase hex.
 */
function sign(params, appSecret) {
  const base = Object.keys(params)
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join('');
  return crypto.createHmac('sha256', appSecret).update(base, 'utf8').digest('hex').toUpperCase();
}

/**
 * Call an AliExpress affiliate API method, e.g. 'aliexpress.affiliate.hotproduct.query'.
 * Returns the parsed resp_result.result payload, or throws on API errors.
 */
async function callAliexpress(method, bizParams = {}) {
  const { appKey, appSecret, apiBase } = config.aliexpress;
  if (!appKey || !appSecret) {
    throw new Error('Missing ALI_APP_KEY / ALI_APP_SECRET in .env');
  }

  const params = {
    app_key: appKey,
    method,
    sign_method: 'sha256',
    timestamp: String(Date.now()),
    v: '2.0',
    format: 'json',
  };
  for (const [k, v] of Object.entries(bizParams)) {
    if (v !== undefined && v !== null && v !== '') params[k] = String(v);
  }
  params.sign = sign(params, appSecret);

  const res = await fetch(apiBase, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data) {
    throw new Error(`AliExpress API HTTP error: ${res.status}`);
  }

  // Gateway-level error (bad sign, quota exceeded, etc.)
  if (data.error_response) {
    const e = data.error_response;
    throw new Error(`AliExpress API error ${e.code}: ${e.msg}${e.sub_msg ? ` (${e.sub_msg})` : ''}`);
  }

  // Business response key mirrors the method name, e.g.
  // aliexpress_affiliate_hotproduct_query_response
  const respKey = `${method.replace(/\./g, '_')}_response`;
  const resp = data[respKey]?.resp_result;
  if (!resp) {
    throw new Error(`AliExpress API: unexpected response shape for ${method}`);
  }
  if (String(resp.resp_code) !== '200') {
    throw new Error(`AliExpress API resp_code ${resp.resp_code}: ${resp.resp_msg || 'unknown error'}`);
  }
  return resp.result;
}

module.exports = { callAliexpress, sign };
