mod cli;
mod exec;
mod node;
mod stream;

use cli::{CliResult, Risk};

/// Leitura com JSON: só comandos classificados como `READ`.
#[tauri::command]
async fn dlx_json(args: Vec<String>) -> Result<serde_json::Value, String> {
    match cli::classify(&args) {
        Some(Risk::Read) => {}
        _ => return Err(format!("não é um comando de leitura permitido: delonix {}", args.join(" "))),
    }
    let r = cli::exec(&args).await?;
    if !r.ok {
        return Err(if r.stderr.trim().is_empty() { format!("delonix saiu com código {}", r.code) } else { r.stderr });
    }
    serde_json::from_str(&r.stdout)
        .map_err(|e| format!("JSON inválido de `delonix {}`: {e}", args.join(" ")))
}

/// Execução de uma ação. Disruptivas e destrutivas exigem `confirm = true`,
/// tal como as ferramentas do servidor MCP do engine.
#[tauri::command]
async fn dlx_run(args: Vec<String>, confirm: bool) -> Result<CliResult, String> {
    match cli::classify(&args) {
        None => Err(format!("comando não permitido na app: delonix {}", args.join(" "))),
        Some(r) if r.requires_confirm() && !confirm => Err(format!(
            "POLICY_DENIED: `delonix {}` é {:?} e precisa de confirmação",
            args.join(" "),
            r
        )),
        Some(_) => cli::exec(&args).await,
    }
}

/// Autentica num registry OCI. A password vem só por este caminho (stdin do
/// processo `image login --password-stdin`); NUNCA passa pelo argv de `dlx_run`.
/// A password não é registada em histórico, logs nem mensagens de erro.
#[tauri::command]
async fn dlx_login(registry: String, username: String, password: String) -> Result<CliResult, String> {
    cli::login(&registry, &username, &password).await
}

/// Classe de risco de um comando, para a UI decidir se mostra confirmação.
#[tauri::command]
fn dlx_risk(args: Vec<String>) -> Option<Risk> {
    cli::classify(&args)
}

/// kubectl de LEITURA contra o kubeconfig em cache de um cluster (ver nós, pods,
/// namespaces, logs). O engine 5.1.1 não tem `cluster kubectl` passthrough, por
/// isso corre o `kubectl` do sistema; o subcomando é REVALIDADO aqui como
/// só-leitura (`cli::kubectl_read_only`), nunca entrando pela allowlist genérica
/// do `dlx_run` (que permitiria kubectl destrutivo). Falha fechada.
#[tauri::command]
async fn dlx_kubectl(cluster: String, args: Vec<String>) -> Result<CliResult, String> {
    cli::kubectl(&cluster, &args).await
}

/// Caminho do binário em uso, para a barra de estado.
#[tauri::command]
fn dlx_bin() -> String {
    cli::bin().display().to_string()
}

/// Diretório HOME do utilizador, para o explorador começar aí (e o botão "ir
/// para HOME"). Lê `$HOME` sem passar pelo plugin de path; cai em "/" se faltar.
#[tauri::command]
fn dlx_home_dir() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".to_string())
}

/// Grava TEXTO num caminho ESCOLHIDO pelo utilizador no diálogo de gravação
/// nativo. É o ÚNICO caminho de escrita da app: o plugin `fs` só tem permissões
/// de LEITURA (ver capabilities/default.json), por isso o webview não pode
/// escrever em lado nenhum por conta própria. O caminho vem sempre de uma ação
/// explícita do utilizador (save-dialog), nunca de dados não confiáveis.
#[tauri::command]
async fn dlx_save_text(path: String, content: String) -> Result<(), String> {
    tokio::fs::write(&path, content)
        .await
        .map_err(|e| format!("não foi possível gravar em {path}: {e}"))
}

/// Grava TEXTO no caminho de um ficheiro ABERTO no IDE integrado (§10). É o
/// segundo (e último) caminho de escrita da app, a par de `dlx_save_text`: o
/// plugin `fs` continua só-leitura, por isso o webview nunca escreve por conta
/// própria. A diferença de intenção é o Ctrl+S / botão Guardar — o caminho não
/// vem de um save-dialog mas do ficheiro que o utilizador abriu no explorador
/// do editor, por isso VALIDAMOS: tem de ser ABSOLUTO e não-vazio (recusa
/// caminhos relativos ou vazios, que poderiam resolver contra o cwd do engine).
/// NÃO cria diretórios nem segue intenções implícitas: grava onde foi pedido.
#[tauri::command]
async fn dlx_write_text(path: String, content: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("caminho vazio: nada para gravar".to_string());
    }
    if !std::path::Path::new(trimmed).is_absolute() {
        return Err(format!("caminho não é absoluto: {trimmed}"));
    }
    tokio::fs::write(trimmed, content)
        .await
        .map_err(|e| format!("não foi possível gravar em {trimmed}: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Plugins oficiais do SO (eixo A). O window-state restaura a geometria
        // da janela ao arrancar e guarda-a ao sair (§7) — tem de entrar cedo
        // para apanhar a criação da janela. Os restantes expõem comandos que o
        // frontend invoca por `lib/native.ts`, autorizados em
        // `capabilities/default.json`.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        // Explorador de ficheiros (eixo A): LEITURA do filesystem. O scope
        // amplo (read-only) vive em capabilities/default.json; a escrita NÃO
        // passa por aqui (ver `dlx_save_text`).
        .plugin(tauri_plugin_fs::init())
        .manage(stream::Streams::default())
        .manage(exec::Execs::default())
        .invoke_handler(tauri::generate_handler![
            dlx_json,
            dlx_run,
            dlx_login,
            dlx_risk,
            dlx_kubectl,
            dlx_bin,
            dlx_home_dir,
            dlx_save_text,
            dlx_write_text,
            stream::dlx_stream_start,
            stream::dlx_stream_stop,
            exec::dlx_exec_start,
            exec::dlx_exec_write,
            exec::dlx_exec_resize,
            exec::dlx_exec_stop,
            exec::dlx_host_identity,
            node::node_vm_list,
            node::node_vm_get,
            node::node_vm_create,
            node::node_vm_start,
            node::node_vm_stop,
            node::node_vm_delete,
            node::node_vm_snapshot_create,
            node::node_vm_snapshots,
            node::node_vm_snapshot_restore,
            node::node_containers,
            node::node_container
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Delonix Desktop");
}
