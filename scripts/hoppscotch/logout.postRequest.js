if (pw.response.status === 200) {
  pw.env.set('access_token', '');
  pw.env.set('refresh_token', '');
  for (const currency of ['cngn', 'cghs', 'cxaf', 'usdx', 'eurx'])
    pw.env.set(`${currency}_wallet_id`, '');
}
