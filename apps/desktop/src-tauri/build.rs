fn main() {
    // Gera o cliente gRPC de `delonix.node.v1` (ContainerService: Logs/Exec/Stats
    // — ver proto/delonix/node/v1/compute.proto). `build_server(false)`: o desktop
    // é puro cliente. Precisa de `protoc` no PATH (igual ao runtime).
    tonic_build::configure()
        .build_server(false)
        .compile_protos(&["proto/delonix/node/v1/compute.proto"], &["proto"])
        .expect("falha a compilar o proto node.v1 (protoc instalado?)");
    println!("cargo:rerun-if-changed=proto/delonix/node/v1/compute.proto");

    tauri_build::build()
}
