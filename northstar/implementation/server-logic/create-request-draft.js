function post() {
  const reply = value => JSON.stringify(value);
  const denied = code => reply({ ok: false, code });
  const guid = new RegExp(
    '^[0-9a-f]{8}-[0-9a-f]{4}-' +
    '[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', 'i'
  );

  try {
    const gate = Server.SiteSetting.Get(
      'Northstar/DraftWriteContract'
    );
    if (gate !== 'verified-v1') {
      return denied('NOT_CONFIGURED');
    }

    const user = Server.User;
    // Deployment must verify this contact-ID contract.
    const contactId = user && user.contactid;
    if (typeof contactId !== 'string' ||
        !guid.test(contactId) ||
        contactId.replace(/-/g, '') === '0'.repeat(32)) {
      return denied('NOT_AUTHORIZED');
    }

    const raw = Server.Context.Body;
    if (typeof raw !== 'string' || raw.length > 8192) {
      return denied('INVALID_INPUT');
    }
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' ||
        Array.isArray(body)) {
      return denied('INVALID_INPUT');
    }
    const allowed = ['ns_name', 'ns_description'];
    const keys = Object.keys(body);
    if (keys.length !== 2 ||
        keys.some(key => !allowed.includes(key))) {
      return denied('INVALID_INPUT');
    }
    if (typeof body.ns_name !== 'string' ||
        typeof body.ns_description !== 'string') {
      return denied('INVALID_INPUT');
    }
    const name = body.ns_name.trim();
    const description = body.ns_description.trim();
    if (!name || name.length > 200 ||
        !description || description.length > 4000) {
      return denied('INVALID_INPUT');
    }
    // Trusted deployment constant: verify in metadata.
    const contactNavigation = 'ns_contact';
    const payload = {
      ns_name: name,
      ns_description: description
    };
    payload[contactNavigation + '@odata.bind'] =
      'contacts(' + contactId + ')';
    const result = Server.Connector.Dataverse.CreateRecord(
      'ns_requests', JSON.stringify(payload)
    );
    const envelope = typeof result === 'string'
      ? JSON.parse(result) : result;
    if (!envelope || envelope.IsSuccessStatusCode !== true ||
        ![200, 201, 204].includes(envelope.StatusCode)) {
      return denied('CREATE_FAILED');
    }
    return reply({ ok: true, created: true });
  } catch (error) {
    Server.Logger.Error('Northstar draft create failed');
    return denied('CREATE_FAILED');
  }
}
