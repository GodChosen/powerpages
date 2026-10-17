function get() {
  const fail = () => JSON.stringify({
    ok: false, code: 'UNAVAILABLE'
  });
  try {
    if (!Server.User) return fail();
    const id = Server.Context.QueryParameters['id'];
    const guid = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
    if (typeof id !== 'string' || !guid.test(id) ||
        id.replace(/-/g, '') === '0'.repeat(32)) return fail();
    const raw = Server.Connector.Dataverse.RetrieveRecord(
      'ns_requests', id,
      '$select=ns_name,ns_description,ns_reference,' +
        'ns_publicstatus,ns_submissionstatus', true
    );
    const envelope = typeof raw === 'string'
      ? JSON.parse(raw) : raw;
    if (!envelope || envelope.IsSuccessStatusCode !== true ||
        envelope.StatusCode !== 200 ||
        envelope.ServerError === true) return fail();
    const row = typeof envelope.Body === 'string'
      ? JSON.parse(envelope.Body) : envelope.Body;
    if (!row || typeof row.ns_name !== 'string' ||
        typeof row.ns_description !== 'string' ||
        typeof row.ns_reference !== 'string' ||
        typeof row.ns_publicstatus !== 'string' ||
        ![729100000, 729100001, 729100002].includes(
          row.ns_submissionstatus)) return fail();
    const etag = row['@odata.etag'];
    const version = typeof etag === 'string'
      ? /^W\/"([0-9]{1,32})"$/.exec(etag) : null;
    if (!version) return fail();
    return JSON.stringify({ ok: true, request: {
      id, name: row.ns_name, description: row.ns_description,
      reference: row.ns_reference,
      publicStatus: row.ns_publicstatus,
      submissionStatus: row.ns_submissionstatus,
      rowVersion: version[1]
    } });
  } catch (error) {
    Server.Logger.Error('Northstar request state failed');
    return fail();
  }
}
