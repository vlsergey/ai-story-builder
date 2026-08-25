const fs = require("fs")
let p = "src/shared/ai-engine-config.ts"
let s = fs.readFileSync(p, "utf8")
if (!s.includes("OllamaEngineConfig")) {
  s = s.replace("  yandex?: YandexEngineConfig\n}", "  yandex?: YandexEngineConfig\n  ollama?: OllamaEngineConfig\n}")
  const anchor = `export interface YandexEngineConfig extends AiEngineConfig<YandexAiGenerationSettings> {
  folder_id?: string
  search_index_id?: string
}
`
  if (!s.includes(anchor)) throw new Error("anchor not found")
  s = s.replace(
    anchor,
    anchor +
      `
export interface OllamaEngineConfig extends AiEngineConfig<OllamaAiGenerationSettings> {
  /** Where the Ollama daemon listens. Defaults to http://localhost:11434. */
  base_url?: string
}
`,
  )
  fs.writeFileSync(p, s)
  console.log("OllamaEngineConfig добавлен")
}
p = "src/backend/ai/ai-engine-adapter.ts"
s = fs.readFileSync(p, "utf8")
if (!s.includes("ollama: new OllamaAdapter()")) {
  s = s.replace(
    "  yandex: new YandexAdapter(),\n} as const",
    "  yandex: new YandexAdapter(),\n  ollama: new OllamaAdapter(),\n} as const",
  )
  fs.writeFileSync(p, s)
  console.log("адаптер зарегистрирован")
}
