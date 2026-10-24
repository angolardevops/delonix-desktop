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

/// Caminho do binário em uso, para a barra de estado.
#[tauri::command]
fn dlx_bin() -> String {
    cli::bin().display().to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(stream::Streams::default())
        .manage(exec::Execs::default())
        .invoke_handler(tauri::generate_handler![
            dlx_json,
            dlx_run,
            dlx_login,
            dlx_risk,
            dlx_bin,
            stream::dlx_stream_start,
            stream::dlx_stream_stop,
            exec::dlx_exec_start,
            exec::dlx_exec_write,
            exec::dlx_exec_resize,
            exec::dlx_exec_stop,
            node::node_vm_list,
            node::node_vm_get,
            node::node_vm_create,
            node::node_vm_start,
            node::node_vm_stop,
            node::node_vm_delete,
            node::node_vm_snapshot_create,
            node::node_vm_snapshots,
            node::node_vm_snapshot_restore
        ])
        .run(tauri::generate_context!())
        .expect("erro ao iniciar o Delonix Desktop");
}
