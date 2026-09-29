/**
 * PAOZINHOS V2 — bootstrap de autenticação Supabase.
 *
 * Execute somente depois de configurar:
 *   SUPABASE_URL
 *   SUPABASE_SECRET_KEY
 *
 * Este arquivo cria usuários Auth usando o telefone como login,
 * preservando o mesmo conceito da V1.
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

  if (body !== undefined) {
    options.payload = JSON.stringify(body);
  }

  const response = UrlFetchApp.fetch(
    cfg.url + path,
    options
  );

  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error(
      'Supabase Auth HTTP ' + code + ': ' +
      text.slice(0, 1200)
    );
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

    const batch = data && Array.isArray(data.users)
      ? data.users
      : [];

    users.push.apply(users, batch);

    if (batch.length < 1000) break;
    page++;
  }

  return users;
}

function normalizarTelefoneAuth_(valor) {
  let digits = String(valor || '').replace(/\D/g, '');
  if (!digits) return '';

  if (digits.indexOf('55') === 0) {
    return '+' + digits;
  }

  if (digits.length === 10 || digits.length === 11) {
    return '+55' + digits;
  }

  return '+' + digits;
}

function gerarSenhaTemporaria_() {
  const chars =
    'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

  let out = '';
  for (let i = 0; i < 10; i++) {
    const index = Math.floor(Math.random() * chars.length);
    out += chars.charAt(index);
  }

  return out;
}

function vincularClienteUsuarioSupabase_(clienteId, usuarioId) {
  const cfg = supabaseAuthConfig_();

  const response = UrlFetchApp.fetch(
    cfg.url +
      '/rest/v1/clientes?id=eq.' +
      encodeURIComponent(clienteId),
    {
      method: 'patch',
      muteHttpExceptions: true,
      headers: {
        Authorization: 'Bearer ' + cfg.key,
        apikey: cfg.key,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      payload: JSON.stringify({
        usuario_id: usuarioId
      })
    }
  );

  const code = response.getResponseCode();

  if (code < 200 || code >= 300) {
    throw new Error(
      'Falha ao vincular cliente ' + clienteId +
      ': HTTP ' + code + ' ' +
      response.getContentText().slice(0, 800)
    );
  }
}

/**
 * Cria/mapeia os usuários Auth dos clientes já migrados.
 *
 * Retorna as senhas temporárias SOMENTE para os usuários criados
 * nesta execução. Elas devem ser entregues aos clientes pelo fluxo
 * de acesso do sistema e não devem ser salvas no GitHub.
 */
function migrarUsuariosAuthSupabase() {
  const ss = SpreadsheetApp.openById(
    MIGRACAO_SUPABASE_SPREADSHEET_ID
  );

  const clientesRows = migRead_(
    ss,
    MIGRACAO_SUPABASE_SHEETS.clientes,
    9,
    2
  );

  const cfg = supabaseAuthConfig_();
  const users = supabaseAuthListUsers_();

  const porId = {};
  const porPhone = {};

  users.forEach(function(user) {
    if (user.id) porId[user.id] = user;

    if (user.phone) {
      porPhone[
        normalizarTelefoneAuth_(user.phone)
      ] = user;
    }
  });

  const criados = [];
  const vinculados = [];
  const ignorados = [];

  clientesRows.forEach(function(r) {
    const clienteId = migUuid_(
      'cliente|' + migNormalize_(r[0])
    );

    const nome = migNormalize_(r[1]);
    const telefone = normalizarTelefoneAuth_(r[2]);

    if (!clienteId || !nome || !telefone) {
      ignorados.push({
        nome: nome,
        telefone: telefone,
        motivo: 'Cliente sem ID, nome ou telefone válido.'
      });
      return;
    }

    let user = porId[clienteId] || porPhone[telefone];
    let senhaTemporaria = '';

    if (!user) {
      senhaTemporaria = gerarSenhaTemporaria_();

      const data = supabaseAuthRequest_(
        '/auth/v1/admin/users',
        'post',
        {
          id: clienteId,
          phone: telefone,
          password: senhaTemporaria,
          phone_confirm: true,
          user_metadata: {
            nome: nome,
            primeira_senha: true
          },
          app_metadata: {
            tipo: 'cliente'
          }
        }
      );

      user = data && data.user
        ? data.user
        : data;

      if (!user || !user.id) {
        throw new Error(
          'Supabase Auth não retornou o usuário criado para ' +
          nome + '.'
        );
      }

      porId[user.id] = user;
      porPhone[telefone] = user;

      criados.push({
        clienteId: clienteId,
        usuarioId: user.id,
        nome: nome,
        telefone: telefone,
        senhaTemporaria: senhaTemporaria
      });
    }

    vincularClienteUsuarioSupabase_(
      clienteId,
      user.id
    );

    vinculados.push({
      clienteId: clienteId,
      usuarioId: user.id,
      nome: nome,
      telefone: telefone,
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
 *
 * Antes de executar, configure:
 *   SUPABASE_ADMIN_EMAIL
 *   SUPABASE_ADMIN_PASSWORD
 *
 * O usuário é criado com email confirmado e role "admin"
 * na tabela public.perfis.
 */
function criarAdminSupabase() {
  const p = PropertiesService.getScriptProperties();

  const email = String(
    p.getProperty('SUPABASE_ADMIN_EMAIL') || ''
  ).trim();

  const senha = String(
    p.getProperty('SUPABASE_ADMIN_PASSWORD') || ''
  );

  if (!email || !senha) {
    throw new Error(
      'Configure SUPABASE_ADMIN_EMAIL e SUPABASE_ADMIN_PASSWORD ' +
      'antes de criar o administrador.'
    );
  }

  const users = supabaseAuthListUsers_();
  let user = users.find(function(x) {
    return String(x.email || '').toLowerCase() ===
      email.toLowerCase();
  });

  if (!user) {
    const data = supabaseAuthRequest_(
      '/auth/v1/admin/users',
      'post',
      {
        email: email,
        password: senha,
        email_confirm: true,
        user_metadata: {
          nome: 'Administrador'
        },
        app_metadata: {
          tipo: 'admin'
        }
      }
    );

    user = data && data.user ? data.user : data;
  }

  if (!user || !user.id) {
    throw new Error(
      'Não foi possível criar/localizar o administrador.'
    );
  }

  // Atualiza o perfil criado pelo trigger.
  const cfg = supabaseAuthConfig_();

  const response = UrlFetchApp.fetch(
    cfg.url +
      '/rest/v1/perfis?id=eq.' +
      encodeURIComponent(user.id),
    {
      method: 'patch',
      muteHttpExceptions: true,
      headers: {
        Authorization: 'Bearer ' + cfg.key,
        apikey: cfg.key,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      payload: JSON.stringify({
        role: 'admin'
      })
    }
  );

  const code = response.getResponseCode();

  if (code < 200 || code >= 300) {
    throw new Error(
      'Não foi possível definir role admin: HTTP ' +
      code + ' ' +
      response.getContentText().slice(0, 800)
    );
  }

  const resultado = {
    ok: true,
    usuarioId: user.id,
    email: email
  };

  Logger.log(JSON.stringify(resultado, null, 2));
  return resultado;
}
