//! `delonix-desktop-proof` — prova headless da Fase 1.
//!
//! Exercita, por CÓDIGO (não por curl à mão), o caminho crítico do desktop:
//!   1. liga ao node-api no socket Unix e lê a raiz hipermédia;
//!   2. lê NodeInfo, Health e o catálogo de providers/capabilities (feature-gating);
//!   3. corre um container pela ponte CLI-JSON, lista-o, lê os seus logs;
//!   4. limpa o que criou.
//!
//! Uso:
//!   DELONIX_NODE_API_ADDR=unix://$XDG_RUNTIME_DIR/delonix-node.sock \
//!   DELONIX_BIN=delonix \
//!   delonix-desktop-proof [--run]
//!
//! Sem `--run`, só faz as leituras do contrato (não cria workloads).
//! Código de saída 0 = tudo passou; !=0 = alguma etapa falhou (CI-friendly).

use std::process::ExitCode;

use delonix_desktop_core::model::CapabilityState;
use delonix_desktop_core::{CliBridge, NodeClient};

fn main() -> ExitCode {
    match run() {
        Ok(()) => {
            println!("\n✅ prova concluída — caminho cliente↔runtime validado");
            ExitCode::SUCCESS
        }
        Err(e) => {
            eprintln!("\n❌ prova falhou: {e}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> delonix_desktop_core::Result<()> {
    let do_run = std::env::args().any(|a| a == "--run");

    // ── 1. Contrato: raiz hipermédia ────────────────────────────────────
    let node = NodeClient::from_env();
    println!("→ node-api socket: {}", node.socket().display());
    let root = node.api_root()?;
    println!("  api_version = {}", root.api_version);
    let served: Vec<&str> = root.links.iter().map(|l| l.rel.as_str()).collect();
    println!("  recursos servidos: {}", served.join(", "));
    println!(
        "  containers no contrato? {}  (senão → ponte CLI-JSON)",
        root.serves("containers")
    );

    // ── 2. NodeInfo / Health / Providers ────────────────────────────────
    let info = node.node_info()?;
    println!(
        "→ node: {} {} rootless={} cgroup_delegated={} workloads={:?}",
        info.arch,
        info.engine_version,
        info.rootless,
        info.cgroup_delegated,
        info.supported_workload_types
    );

    let health = node.health()?;
    let healthy = health.conditions.iter().filter(|c| c.is_true()).count();
    println!(
        "→ health: {}/{} condições OK",
        healthy,
        health.conditions.len()
    );
    for c in &health.conditions {
        println!(
            "   [{}] {} — {}",
            if c.is_true() { "ok" } else { "!!" },
            c.kind,
            c.reason
        );
    }

    let providers = node.providers()?;
    println!("→ providers: {}", providers.providers.len());
    for p in &providers.providers {
        let actionable = p
            .capabilities
            .iter()
            .filter(|c| c.state.is_actionable())
            .count();
        println!(
            "   {}/{} available={} caps={} (accionáveis={})",
            p.kind,
            p.id,
            p.available,
            p.capabilities.len(),
            actionable
        );
    }
    println!("→ histograma de estados de capability (feature-gating):");
    for (state, n) in providers.state_histogram() {
        println!("   {state:28} {n}");
    }
    // Sanidade: tem de haver pelo menos um Supported e o catálogo tem de existir.
    let total: usize = providers
        .providers
        .iter()
        .map(|p| p.capabilities.len())
        .sum();
    if total == 0 {
        return Err(delonix_desktop_core::CoreError::Protocol(
            "catálogo de capabilities vazio — contrato não está a reportar providers".into(),
        ));
    }
    let any_supported = providers
        .providers
        .iter()
        .flat_map(|p| &p.capabilities)
        .any(|c| c.state == CapabilityState::Supported);
    assert_contract(
        any_supported,
        "nenhuma capability 'supported' — inesperado neste host",
    )?;

    // ── 3. Ponte CLI-JSON: ciclo de vida de um container ────────────────
    if !do_run {
        println!("\n(sem --run: a saltar criação de workload; leituras do contrato OK)");
        return Ok(());
    }

    let cli = CliBridge::from_env();
    let name = "dd-core-proof";
    // limpeza defensiva de uma corrida anterior
    let _ = cli.stop(name);
    let _ = cli.remove(name);

    println!("\n→ a correr container {name} (busybox, ponte CLI-JSON)…");
    let id = cli.run_detached(
        name,
        "docker.io/library/busybox:latest",
        &[
            "sh",
            "-c",
            "for i in $(seq 1 10); do echo tick $i; sleep 1; done",
        ],
    )?;
    println!("   id = {id}");

    let found = cli.containers()?.into_iter().find(|w| w.name == name);
    match &found {
        Some(w) => println!("   ps: {} [{}] {}", w.name, w.display_status(), w.image),
        None => {
            return Err(delonix_desktop_core::CoreError::Protocol(
                "container criado não aparece em `container ps -o json`".into(),
            ))
        }
    }

    std::thread::sleep(std::time::Duration::from_secs(2));
    let logs = cli.logs(name)?;
    let lines: Vec<&str> = logs.lines().take(3).collect();
    println!("   logs (3 primeiras): {:?}", lines);
    assert_contract(
        lines.iter().any(|l| l.contains("tick")),
        "logs do container não contêm a saída esperada",
    )?;

    println!("→ limpeza…");
    cli.stop(name)?;
    cli.remove(name)?;
    let still = cli.containers_all()?.iter().any(|w| w.name == name);
    assert_contract(!still, "container de prova ficou órfão após rm")?;
    println!("   0 órfãos");

    Ok(())
}

fn assert_contract(cond: bool, msg: &str) -> delonix_desktop_core::Result<()> {
    if cond {
        Ok(())
    } else {
        Err(delonix_desktop_core::CoreError::Protocol(msg.into()))
    }
}
