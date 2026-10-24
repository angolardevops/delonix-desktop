//! Ponte para o CLI `delonix`.
//!
//! O Delonix Engine é daemonless: o CLI é a fonte de verdade e a própria API de
//! gestão (`delonix serve api`) chama o CLI para as mutações. Por isso a app usa
//! o CLI diretamente, sempre com argv (nunca uma shell), e lê `-o json`
//! (contrato ADR-0005 do delonix-runtime).
//!
//! Cada comando permitido tem uma classe de risco com os MESMOS nomes do servidor
//! MCP do engine (`crates/interfaces/delonix-mcp/src/risk.rs`). Um comando que não
//! está na lista é recusado (falha fechada), tal como o MCP trata uma ferramenta
//! desconhecida como `PRIVILEGED`.

use serde::Serialize;
use std::path::PathBuf;
use tokio::process::Command;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum Risk {
    Read,
    SafeWrite,
    Disruptive,
    Destructive,
}

impl Risk {
    /// Igual ao MCP: acima de `SafeWrite` exige `confirm: true` vindo da UI.
    pub fn requires_confirm(self) -> bool {
        !matches!(self, Risk::Read | Risk::SafeWrite)
    }
}

/// Prefixos de argv permitidos e a sua classe. O primeiro que casa ganha, por
/// isso os mais específicos vêm primeiro.
const RULES: &[(&[&str], Risk)] = &[
    // Verbos AGRUPADOS (existem no release 5.1.1 E na develop). Não usar os
    // aliases de raiz estilo Docker (run/ps/images/logs/…): só existem na
    // develop, partem contra o engine 5.1.1.
    // Leitura (todas com JSON estável)
    (&["dashboard"], Risk::Read),
    (&["workload", "ls"], Risk::Read),
    (&["workload", "describe"], Risk::Read),
    (&["container", "ps"], Risk::Read),
    (&["image", "ls"], Risk::Read),
    (&["volume", "ls"], Risk::Read),
    (&["network", "ls"], Risk::Read),
    (&["vm", "ls"], Risk::Read),
    (&["provider", "ls"], Risk::Read),
    (&["provider", "describe"], Risk::Read),
    (&["system", "info"], Risk::Read),
    (&["system", "doctor"], Risk::Read),
    (&["system", "features"], Risk::Read),
    (&["mcp", "capabilities"], Risk::Read),
    (&["mcp", "doctor"], Risk::Read),
    (&["version"], Risk::Read),
    // Escrita segura
    (&["image", "pull"], Risk::SafeWrite),
    (&["container", "start"], Risk::SafeWrite),
    (&["vm", "start"], Risk::SafeWrite),
    (&["volume", "create"], Risk::SafeWrite),
    (&["network", "create"], Risk::SafeWrite),
    (&["container", "run"], Risk::SafeWrite),
    // Disruptivas
    (&["workload", "stop"], Risk::Disruptive),
    (&["container", "stop"], Risk::Disruptive),
    (&["vm", "stop"], Risk::Disruptive),
    (&["container", "restart"], Risk::Disruptive),
    (&["vm", "restart"], Risk::Disruptive),
    // Destrutivas
    (&["workload", "rm"], Risk::Destructive),
    (&["container", "rm"], Risk::Destructive),
    (&["image", "remove"], Risk::Destructive),
    (&["volume", "rm"], Risk::Destructive),
    (&["network", "rm"], Risk::Destructive),
];

pub fn classify(args: &[String]) -> Option<Risk> {
    RULES
        .iter()
        .find(|(prefix, _)| {
            args.len() >= prefix.len() && prefix.iter().zip(args).all(|(p, a)| p == a)
        })
        .map(|(_, r)| *r)
}

/// O binário `delonix`: `$DELONIX_BIN`, senão o que estiver no PATH.
pub fn bin() -> PathBuf {
    std::env::var_os("DELONIX_BIN")
        .map(PathBuf::from)
        .or_else(|| which::which("delonix").ok())
        .unwrap_or_else(|| PathBuf::from("delonix"))
}

#[derive(Debug, Clone, Serialize)]
pub struct CliResult {
    pub ok: bool,
    pub code: i32,
    pub stdout: String,
    pub stderr: String,
    pub argv: Vec<String>,
}

pub async fn exec(args: &[String]) -> Result<CliResult, String> {
    let out = Command::new(bin())
        .args(args)
        .env("NO_COLOR", "1")
        .output()
        .await
        .map_err(|e| format!("não foi possível executar `delonix`: {e}. Define DELONIX_BIN ou instala o CLI."))?;
    let mut argv = vec!["delonix".to_string()];
    argv.extend(args.iter().cloned());
    Ok(CliResult {
        ok: out.status.success(),
        code: out.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        argv,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(s: &str) -> Vec<String> {
        s.split_whitespace().map(String::from).collect()
    }

    #[test]
    fn unknown_commands_are_refused() {
        assert_eq!(classify(&v("system setup --delegate")), None);
        assert_eq!(classify(&v("cluster apply")), None);
    }

    #[test]
    fn root_docker_aliases_are_refused() {
        // Só existem na develop; partem contra o release 5.1.1. O desktop emite
        // as formas agrupadas, por isso os aliases de raiz têm de ficar FORA.
        for a in ["run nginx", "ps", "images", "logs -f x", "pull x", "rmi x", "start x", "stop x", "restart x", "rm -f x"] {
            assert_eq!(classify(&v(a)), None, "alias de raiz não devia ser permitido: {a}");
        }
    }

    #[test]
    fn grouped_verbs_are_classified() {
        assert!(!classify(&v("image ls -o json")).unwrap().requires_confirm());
        assert!(classify(&v("workload rm -f odoo-16")).unwrap().requires_confirm());
        assert!(classify(&v("image remove nginx")).unwrap().requires_confirm());
        assert!(classify(&v("vm start fc-1")).is_some());
        assert!(!classify(&v("container run -d nginx")).unwrap().requires_confirm());
    }
}
