import type { GrokFieldKeys, YandexFieldKeys } from "@shared/ai-engines"
import type { ParseKeys } from "i18next"

type AssertExtends<S, _ extends S> = true
type AssertKeysMatch<T extends ParseKeys> = AssertExtends<ParseKeys, T>

type AssertGrokLabels = AssertKeysMatch<`engine.grok.field.${GrokFieldKeys}.label`>
type AssertYandexLabels = AssertKeysMatch<`engine.yandex.field.${YandexFieldKeys}.label`>
