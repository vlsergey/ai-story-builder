import type { GrokFieldKeys, YandexFieldKeys } from "@shared/ai-engines"
import type { ParseKeys } from "i18next"

type AssertExtends<S, _ extends S> = true

type AssertGrokLabels = AssertExtends<ParseKeys<"ai-engines">, `engine.grok.field.${GrokFieldKeys}.label`>
type AssertYandexLabels = AssertExtends<ParseKeys<"ai-engines">, `engine.yandex.field.${YandexFieldKeys}.label`>
