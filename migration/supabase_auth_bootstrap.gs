/**
 * PAOZINHOS V2 — bootstrap de autenticação Supabase.
 *
 * Os clientes usam telefone como login na interface, mas o Supabase
 * Auth utiliza email interno. Isso evita depender de SMS/Twilio.
 *
 * A chave secreta nunca deve ir para o GitHub, navegador ou chat.
 */

function supabaseAuthConfig_() {
  const p = PropertiesService.getScriptProperties();
  const url = String(p.getProperty('SUPABASE_URL') || '').replace(/\/$/, '');
  const key = String(
    p.getProperty('SUPABASE_SECRET_KEY') ||
    p.getProperty('SUPABASE_SERVICE_ROLE_KEY') ||
    ''
  ).trim();

  if (!url || !key) {
    throw new Error('Configure SUPABASE_URL e SUPABASE_SECRET_KEY nas Propriedades do Script.');
  }

  return {url:url, key:key};
}

function supabaseAuthRequest_(path, method, body) {
  const cfg = supabaseAuthConfig_();

  const options = {
    method: method || 'get',
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + cfg.key,
      apikey: cfg.key,
      'Content-Type': 'application/json'
    }
  };

  if (body !== undefined) options.payload = JSON.stringify(body);

  const response = UrlFetchApp.fetch(cfg.url + path, options);
  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error('Supabase Auth HTTP ' + code + ': ' + text.slice(0, 1200));
  }

  return text ? JSON.parse(text) : null;
}

function supabaseAuthListUsers_() {
  const users = [];
  let page = 1;

  while (true) {
    const data = supabaseAuthRequest_(
      '/auth/v1/admin/users?page=' + page + '&per_page=1000',
      'get'
    );

    const batch = data && Array.isArray(data.users) ? data.users : [];
    users.push.apply(users, batch);

    if (batch.length < 1000) break;
    page++;
  }

  return users;
}

function normalizarTelefoneAuth_(valor) {
  const digits = String(valor || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.indexOf('55') === 0) return '+' + digits;
  if (digits.length === 10 || digits.length === 11) return '+55' + digits;
  return '+' + digits;
}

function emailInternoClienteSupabase_(telefone) {
  const digits = String(telefone || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits + '@clientes.paozinhos.local';
}

function gerarSenhaTemporaria_() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < 10; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

function vincularClienteUsuarioSupabase_(clienteId, usuarioId) {
  const cfg = supabaseAuthConfig_();

  const response = UrlFetchApp.fetch(
    cfg.url + '/rest/v1/clientes?id=eq.' + encodeURIComponent(clienteId),
    {
      method: 'patch',
      muteHttpExceptions: true,
      headers: {
        Authorization: 'Bearer ' + cfg.key,
        apikey: cfg.key,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      payload: JSON.stringify({usuario_id: usuarioId})
    }
  );

  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(
      'Falha ao vincular cliente ' + clienteId +
      ': HTTP ' + code + ' ' + response.getContentText().slice(0, 800)
    );
  }
}

/**
 * Migra os usuários já criados com telefone para email interno.
 *
 * O cliente continua digitando o TELEFONE no site.
 * O frontend converte o telefone para o email interno antes do login.
 *
 * A senha atual de cada usuário é preservada.
 * Nenhum SMS/Twilio é necessário.
 *
 * Execute UMA vez depois desta atualização.
 */
function migrarLoginEmailClientesSupabase() {
  const ss = SpreadsheetApp.openById(MIGRACAO_SUPABASE_SPREADSHEET_ID);
  const clientesRows = migRead_(ss, MIGRACAO_SUPABASE_SHEETS.clientes, 9, 2);
  const users = supabaseAuthListUsers_();

  const porId = {};
  const porPhone = {};
  const porEmail = {};

  users.forEach(function(user) {
    if (user.id) porId[user.id] = user;
    if (user.phone) porPhone[normalizarTelefoneAuth_(user.phone)] = user;
    if (user.email) porEmail[String(user.email).toLowerCase()] = user;
  });

  const migrados = [];
  const erros = [];

  clientesRows.forEach(function(r) {
    try {
      const clienteId = migUuid_('cliente|' + migNormalize_(r[0]));
      const nome = migNormalize_(r[1]);
      const telefone = normalizarTelefoneAuth_(r[2]);
      const email = emailInternoClienteSupabase_(telefone);

      if (!clienteId || !nome || !telefone || !email) {
        throw new Error('Cliente sem ID, nome ou telefone válido.');
      }

      let user = porId[clienteId] || porPhone[telefone] || porEmail[email.toLowerCase()];

      if (!user) {
        throw new Error('Usuário Auth não encontrado para ' + nome + '.');
      }

      const emailOwner = porEmail[email.toLowerCase()];
      if (emailOwner && emailOwner.id !== user.id) {
        throw new Error('Email interno já pertence a outro usuário.');
      }

      if (
        String(user.email || '').toLowerCase() !== email.toLowerCase() ||
        user.phone
      ) {
        user = supabaseAuthRequest_(
          '/auth/v1/admin/users/' + encodeURIComponent(user.id),
          'put',
          {
            email: email,
            email_confirm: true,
            phone: null,
            user_metadata: Object.assign({}, user.user_metadata || {}, {
              nome: nome,
              tipo: 'cliente'
            }),
            app_metadata: Object.assign({}, user.app_metadata || {}, {
              tipo: 'cliente'
            })
          }
        );

        user = user && user.user ? user.user : user;
        if (!user || !user.id) throw new Error('Supabase não retornou o usuário atualizado.');
      }

      vincularClienteUsuarioSupabase_(clienteId, user.id);

      porId[user.id] = user;
      porEmail[email.toLowerCase()] = user;

      migrados.push({
        clienteId: clienteId,
        usuarioId: user.id,
        nome: nome,
        telefone: telefone,
        email: email
      });
    } catch (e) {
      erros.push({
        linha: r[0],
        nome: r[1],
        erro: e.message || String(e)
      });
    }
  });

  const resultado = {
    ok: erros.length === 0,
    migrados: migrados.length,
    erros: erros,
    detalhes: migrados
  };

  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

/**
 * Cria/mapeia usuários Auth de clientes.
 *
 * Para instalações novas, já cria diretamente com email interno.
 */
function migrarUsuariosAuthSupabase() {
  const ss = SpreadsheetApp.openById(MIGRACAO_SUPABASE_SPREADSHEET_ID);
  const clientesRows = migRead_(ss, MIGRACAO_SUPABASE_SHEETS.clientes, 9, 2);
  const users = supabaseAuthListUsers_();

  const porId = {};
  const porEmail = {};

  users.forEach(function(user) {
    if (user.id) porId[user.id] = user;
    if (user.email) porEmail[String(user.email).toLowerCase()] = user;
  });

  const criados = [];
  const vinculados = [];
  const ignorados = [];

  clientesRows.forEach(function(r) {
    const clienteId = migUuid_('cliente|' + migNormalize_(r[0]));
    const nome = migNormalize_(r[1]);
    const telefone = normalizarTelefoneAuth_(r[2]);
    const email = emailInternoClienteSupabase_(telefone);

    if (!clienteId || !nome || !telefone || !email) {
      ignorados.push({
        nome: nome,
        telefone: telefone,
        motivo: 'Cliente sem ID, nome ou telefone válido.'
      });
      return;
    }

    let user = porId[clienteId] || porEmail[email.toLowerCase()];
    let senhaTemporaria = '';

    if (!user) {
      senhaTemporaria = gerarSenhaTemporaria_();

      const data = supabaseAuthRequest_(
        '/auth/v1/admin/users',
        'post',
        {
          id: clienteId,
          email: email,
          password: senhaTemporaria,
          email_confirm: true,
          user_metadata: {
            nome: nome,
            primeira_senha: true,
            tipo: 'cliente'
          },
          app_metadata: {
            tipo: 'cliente'
          }
        }
      );

      user = data && data.user ? data.user : data;
      if (!user || !user.id) {
        throw new Error('Supabase Auth não retornou o usuário criado para ' + nome + '.');
      }

      porId[user.id] = user;
      porEmail[email.toLowerCase()] = user;

      criados.push({
        clienteId: clienteId,
        usuarioId: user.id,
        nome: nome,
        telefone: telefone,
        email: email,
        senhaTemporaria: senhaTemporaria
      });
    }

    vincularClienteUsuarioSupabase_(clienteId, user.id);

    vinculados.push({
      clienteId: clienteId,
      usuarioId: user.id,
      nome: nome,
      telefone: telefone,
      email: email,
      novoUsuario: !!senhaTemporaria
    });
  });

  const resultado = {
    ok: true,
    criados: criados,
    vinculados: vinculados.length,
    ignorados: ignorados
  };

  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}

/**
 * Cria o administrador V2.
 */
function criarAdminSupabase() {
  const p = PropertiesService.getScriptProperties();
  const email = String(p.getProperty('SUPABASE_ADMIN_EMAIL') || '').trim();
  const senha = String(p.getProperty('SUPABASE_ADMIN_PASSWORD') || '');

  if (!email || !senha) {
    throw new Error(
      'Configure SUPABASE_ADMIN_EMAIL e SUPABASE_ADMIN_PASSWORD antes de criar o administrador.'
    );
  }

  const users = supabaseAuthListUsers_();
  let user = users.find(function(x) {
    return String(x.email || '').toLowerCase() === email.toLowerCase();
  });

  if (!user) {
    const data = supabaseAuthRequest_(
      '/auth/v1/admin/users',
      'post',
      {
        email: email,
        password: senha,
        email_confirm: true,
        user_metadata: {nome: 'Administrador'},
        app_metadata: {tipo: 'admin'}
      }
    );

    user = data && data.user ? data.user : data;
  }

  if (!user || !user.id) {
    throw new Error('Não foi possível criar/localizar o administrador.');
  }

  const cfg = supabaseAuthConfig_();
  const response = UrlFetchApp.fetch(
    cfg.url + '/rest/v1/perfis?id=eq.' + encodeURIComponent(user.id),
    {
      method: 'patch',
      muteHttpExceptions: true,
      headers: {
        Authorization: 'Bearer ' + cfg.key,
        apikey: cfg.key,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      payload: JSON.stringify({role: 'admin'})
    }
  );

  const code = response.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error(
      'Não foi possível definir role admin: HTTP ' + code + ' ' +
      response.getContentText().slice(0, 800)
    );
  }

  const resultado = {ok:true, usuarioId:user.id, email:email};
  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}
