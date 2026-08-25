const fs = require("fs")
let p = "src/shared/ai-engine-config.ts"
let s = fs.readFileSync(p, "utf8")
if (!s.includes("OllamaEngineConfig")) {
  s = s.replace("  yandex?: YandexEngineConfig\n}", "  yandex?: YandexEngineConfig\n  ollama?: OllamaEngineConfig\n}")
  const anchor = s.match(/export interface YandexEngineConfig[^}]*}\n/)
  s = s.replace(
    anchor[0],
    `${anchor[0]}
export interface OllamaEngineConfig extends AiEngineConfig<OllamaAiGenerationSettings> {
  /** Where the Ollama daemon listens. Defaults to http://localhost:11434. */
  base_url?: string
}
`,
  )
  fs.writeFileSync(p, s)
}
p = "src/backend/ai/ai-engine-adapter.ts"
s = fs.readFileSync(p, "utf8")
if (!s.includes("ollama: new OllamaAdapter()")) {
  s = s.replace(
    /const adapters = \{([\s\S]*?)\} as const/,
    (m, body) => `const adapters = {${body}  ollama: new OllamaAdapter(),\n} as const`,
  )
  fs.writeFileSync(p, s)
}
console.log("ok")
