function post() {
  const reply = value => JSON.stringify(value);
  const fail = code => reply({ ok: false, code });
  try {
    if (Server.SiteSetting.Get(
      'Northstar/DraftWriteContract'
    ) !== 'verified-v1') return fail('NOT_CONFIGURED');

    const contactId = Server.User && Server.User.contactid;
    const guid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    if (typeof contactId !== 'string' ||
        !guid.test(contactId) ||
        contactId.replace(/-/g, '') === '0'.repeat(32)) {
      return fail('NOT_AUTHORIZED');
    }
    const raw = Server.Context.Body;
    if (typeof raw !== 'string' || raw.length > 1024) {
      return fail('INVALID_INPUT');
    }
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' ||
        Array.isArray(body)) return fail('INVALID_INPUT');
    const keys = Object.keys(body);
    if (keys.length !== 2 || keys.some(key =>
      !['id', 'rowVersion'].includes(key))) {
      return fail('INVALID_INPUT');
    }
    if (typeof body.id !== 'string' || !guid.test(body.id) ||
        body.id.replace(/-/g, '') === '0'.repeat(32) ||
        typeof body.rowVersion !== 'string' ||
        !/^[0-9]{1,32}$/.test(body.rowVersion)) {
      return fail('INVALID_INPUT');
    }

    // Prove current contact-scoped read access first.
    const readRaw = Server.Connector.Dataverse.RetrieveRecord(
      'ns_requests', body.id, '$select=ns_requestid', true
    );
    const read = typeof readRaw === 'string'
      ? JSON.parse(readRaw) : readRaw;
    if (!read || read.IsSuccessStatusCode !== true ||
        read.StatusCode !== 200 || read.ServerError === true) {
      return fail('UNAVAILABLE');
    }
    // The API independently checks this contact and row version.
    const apiRaw = Server.Connector.Dataverse.InvokeCustomApi(
      'post', 'ns_requests(' + body.id +
        ')/Microsoft.Dynamics.CRM.ns_SubmitRequest',
      JSON.stringify({ CallerContact: contactId,
        ExpectedRowVersion: body.rowVersion })
    );
    const api = typeof apiRaw === 'string'
      ? JSON.parse(apiRaw) : apiRaw;
    if (!api || api.IsSuccessStatusCode !== true ||
        ![200, 204].includes(api.StatusCode) ||
        api.ServerError === true) return fail('SUBMIT_FAILED');
    return reply({ ok: true, status: 'submitted' });
  } catch (error) {
    Server.Logger.Error('Northstar submit failed');
    return fail('SUBMIT_FAILED');
  }
}
