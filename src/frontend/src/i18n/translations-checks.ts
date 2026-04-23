import type { GrokFieldKeys, YandexFieldKeys } from "@shared/ai-engines"
import type { TranslationKey } from "./TranslationKey"

type AssertExtends<S, _ extends S> = true
type AssertKeysMatch<T extends TranslationKey> = AssertExtends<TranslationKey, T>

type AssertGrokLabels = AssertKeysMatch<`engine.grok.field.${GrokFieldKeys}.label`>
type AssertYandexLabels = AssertKeysMatch<`engine.yandex.field.${YandexFieldKeys}.label`>
