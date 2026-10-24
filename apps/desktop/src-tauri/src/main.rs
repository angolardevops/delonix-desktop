//! Shell Tauri do Delonix Desktop. Fino por desenho: cada comando delega em
//! `delonix-desktop-core` e devolve DTOs já tipados. Nenhuma lógica de runtime
//! vive aqui, e o webview nunca executa processos nem toca em sockets — só
//! invoca estes comandos (fronteira IPC única, brief §6/§12).

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use delonix_desktop_core::model::{NodeInfo, Provider, ResourceCounts, Workload};
use delonix_desktop_core::LocalContext;

/// Converte qualquer `CoreError` numa string para a fronteira IPC (o webview
/// recebe a mensagem já redigida; detalhes sensíveis não viajam — ver threat
/// model).
fn err(e: delonix_desktop_core::CoreError) -> String {
    e.to_string()
}

#[tauri::command]
fn node_info() -> Result<NodeInfo, String> {
    LocalContext::from_env().node_info().map_err(err)
}

#[tauri::command]
fn list_providers() -> Result<Vec<Provider>, String> {
    LocalContext::from_env()
        .providers()
        .map(|p| p.providers)
        .map_err(err)
}

#[tauri::command]
fn list_containers() -> Result<Vec<Workload>, String> {
    // Inclui parados: a vista oferece "Start" para os que estão em baixo.
    LocalContext::from_env().containers_all().map_err(err)
}

#[tauri::command]
fn container_logs(name: String) -> Result<String, String> {
    LocalContext::from_env().logs(&name).map_err(err)
}

// Mutações de ciclo de vida disparadas pelos botões da lista. Devolvem `()`
// (ou o id, no caso de run) e deixam a UI recarregar `list_containers` para
// observar o novo estado — nada de estado otimista no webview.
#[tauri::command]
fn container_start(name: String) -> Result<(), String> {
    LocalContext::from_env().start_container(&name).map_err(err)
}

#[tauri::command]
fn container_stop(name: String) -> Result<(), String> {
    LocalContext::from_env().stop_container(&name).map_err(err)
}

#[tauri::command]
fn container_remove(name: String) -> Result<(), String> {
    LocalContext::from_env()
        .remove_container(&name)
        .map_err(err)
}

#[tauri::command]
fn container_run(name: String, image: String, command: Vec<String>) -> Result<String, String> {
    let cmd: Vec<&str> = command.iter().map(String::as_str).collect();
    LocalContext::from_env()
        .run_container(&name, &image, &cmd)
        .map_err(err)
}

/// Contagens por recurso para os cartões de métricas do Dashboard. Não falha:
/// cada contagem indisponível vem como `null` e o cartão mostra um traço.
#[tauri::command]
fn resource_counts() -> ResourceCounts {
    LocalContext::from_env().resource_counts()
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            node_info,
            list_providers,
            list_containers,
            container_logs,
            container_start,
            container_stop,
            container_remove,
            container_run,
            resource_counts
        ])
        .run(tauri::generate_context!())
        .expect("erro ao arrancar o Delonix Desktop");
}
