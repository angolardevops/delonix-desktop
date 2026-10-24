//! Erros da camada-core. Distinguem as quatro naturezas que o brief (§7) exige
//! separar: indisponibilidade do contrato, pré-requisito/permissão, protocolo,
//! e falha operacional da CLI.

use std::fmt;

pub type Result<T> = std::result::Result<T, CoreError>;

#[derive(Debug)]
pub enum CoreError {
    /// Não foi possível ligar ao socket do node-api (não está a correr, ou o
    /// uid não tem acesso — `SO_PEERCRED`/`0600`).
    Connect {
        socket: String,
        source: std::io::Error,
    },
    /// O node-api respondeu com um estado não-2xx (o corpo é o problema
    /// RFC 9457, quando presente).
    Http { status: u16, detail: String },
    /// Resposta malformada ao nível do transporte HTTP.
    Protocol(String),
    /// Não foi possível lançar o binário `delonix` (ponte CLI).
    Spawn {
        bin: String,
        source: std::io::Error,
    },
    /// A CLI correu mas devolveu erro (code + stderr).
    Cli {
        args: String,
        code: Option<i32>,
        stderr: String,
    },
    Io(std::io::Error),
    Json(serde_json::Error),
}

impl fmt::Display for CoreError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            CoreError::Connect { socket, source } => {
                write!(f, "sem ligação ao node-api em {socket}: {source}")
            }
            CoreError::Http { status, detail } => {
                write!(f, "node-api respondeu {status}: {detail}")
            }
            CoreError::Protocol(m) => write!(f, "protocolo: {m}"),
            CoreError::Spawn { bin, source } => {
                write!(f, "não foi possível lançar {bin}: {source}")
            }
            CoreError::Cli { args, code, stderr } => {
                write!(f, "`delonix {args}` falhou (code={code:?}): {stderr}")
            }
            CoreError::Io(e) => write!(f, "io: {e}"),
            CoreError::Json(e) => write!(f, "json: {e}"),
        }
    }
}

impl std::error::Error for CoreError {}
