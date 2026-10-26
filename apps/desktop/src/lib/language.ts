// Deteção de LINGUAGEM por nome de ficheiro, para o realce de sintaxe do Monaco
// no IDE integrado (§10). PURA (sem Monaco, sem DOM): recebe um nome/caminho e
// devolve o id de linguagem que o Monaco entende (yaml/json/dockerfile/…) ou
// "plaintext" quando não reconhece. Mantida fora do chunk do editor para poder
// ser testada sem carregar o Monaco (que é pesado e lazy).
//
// Os ids são os registados por omissão no monaco-editor (basic-languages):
// "yaml", "json", "toml", "dockerfile", "shell", "markdown", "ini", "xml",
// "sql", "python", "go", "rust", "typescript", "javascript", "html", "css", …

// Nome do ficheiro (sem diretório), em minúsculas.
export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const i = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return (i >= 0 ? trimmed.slice(i + 1) : trimmed).toLowerCase();
}

// Extensão (sem ponto), em minúsculas; "" quando não há (ou é um dotfile puro
// como ".bashrc", tratado por nome).
export function extName(path: string): string {
  const b = baseName(path);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i + 1) : "";
}

// Ficheiros reconhecidos pelo NOME completo (sem extensão clássica).
const BY_NAME: Record<string, string> = {
  dockerfile: "dockerfile",
  containerfile: "dockerfile",
  makefile: "makefile",
  "docker-compose.yml": "yaml",
  "docker-compose.yaml": "yaml",
  "compose.yml": "yaml",
  "compose.yaml": "yaml",
  caddyfile: "plaintext",
  procfile: "plaintext",
  ".gitignore": "plaintext",
  ".dockerignore": "plaintext",
  ".editorconfig": "ini",
  ".env": "shell",
  ".bashrc": "shell",
  ".zshrc": "shell",
  ".profile": "shell",
};

// Extensão → id de linguagem do Monaco.
const BY_EXT: Record<string, string> = {
  yaml: "yaml",
  yml: "yaml",
  json: "json",
  jsonc: "json",
  json5: "json",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  properties: "ini",
  env: "shell",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  md: "markdown",
  markdown: "markdown",
  xml: "xml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  sql: "sql",
  py: "python",
  go: "go",
  rs: "rust",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  rb: "ruby",
  php: "php",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  tf: "hcl",
  tfvars: "hcl",
  hcl: "hcl",
  dockerfile: "dockerfile",
};

// Linguagem do Monaco para um ficheiro. O NOME tem prioridade (Dockerfile,
// Makefile, docker-compose.yml) sobre a extensão. Fallback: "plaintext".
export function languageForFile(path: string): string {
  const name = baseName(path);
  if (name in BY_NAME) return BY_NAME[name];
  // Dockerfile com sufixo de estágio (ex.: "Dockerfile.dev", "api.dockerfile").
  if (name.startsWith("dockerfile.") || name.endsWith(".dockerfile")) return "dockerfile";
  const ext = extName(path);
  return BY_EXT[ext] ?? "plaintext";
}

// Um ficheiro é YAML/manifesto? (Habilita os botões Validar/Render/Aplicar.)
export function isYamlFile(path: string): boolean {
  return languageForFile(path) === "yaml";
}
