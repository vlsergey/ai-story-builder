# TODO: идеальный шаблон для арки на 30к символов

Резюме обсуждения от 2026-05-13 для подхвата с другого компа. Детальное обоснование решений — в [.claude/research/fiction-arc-pipeline.md](.claude/research/fiction-arc-pipeline.md), дыры в движке — в [.claude/research/graph-primitives-gaps.md](.claude/research/graph-primitives-gaps.md).

## Цель

Пользователь вводит **только синопсис** в визарде. На выходе — арка на 20 частей по ~1500 знаков (≈ 250 слов) каждая. Итого ~30к знаков.

## Math

- 250 слов на сцену укладывается в выходной кап Grok (~1500 слов) с большим запасом.
- Каждая последующая сцена получает **полные тексты всех предыдущих** через `for-each-prev-outputs` — это решено и зафиксировано (см. [project_grok_output_cap](.claude/projects/-home-vlsergey-github-ai-story-builder/memory/project_grok_output_cap.md) в памяти).
- Расход токенов не оптимизируем — приоритет качество.

## Состояние движка

✅ **Сделано:** `split` теперь LLM-driven (коммит `fbdbe20`). Регулярки больше нет, инструкция «как делить» живёт в `ai_user_prompt`. Миграция 027 конвертирует старые проекты автоматически.

⚠️ **Желательно до сборки шаблона:** retry-on-invalid-JSON для обычных `text`-узлов с `responseSchema`. Не блокирует, но в шаблоне будет 1-2 узла с JSON-выходом, и без retry они будут падать в ERROR при первой же кривой JSON-генерации. Изоморфизм с `generateSplitParts` — вытащить цикл в helper.

❌ **Не блокирует, но при возможности:** глобальные переменные через `{{global:name}}`. Без них `Style guide` тянется в 25+ узлов через 25 рёбер — визуальная каша.

## Архитектура шаблона

Все детали — в research-заметке. Здесь короткий чек-лист по блокам в порядке сборки:

### Подготовка (параллельные ветви от Synopsis)
- [ ] `Synopsis` — корневой text, контент из визарда (поле `instructions` или как назовём).
- [ ] `Theme / controlling idea` — text. По МакКи: «о чём это на самом деле», одна фраза.
- [ ] `Genre & register` — text.
- [ ] `Setting / world` — text.
- [ ] `Style guide` — text. Зависит от Theme + Genre. POV, время, ритм, словарь, табу.
- [ ] **Cast bible via for-each по персонажам:**
  - [ ] `Characters (initial list)` — text, 3-5 имён с краткими ремарками.
  - [ ] `llm-split` (per character) — выдаёт массив из N персонажей.
  - [ ] `for-each character:` → `Character profile` (flaw/want/need по Труби, голос, секрет) → `Character review` (fix-problems на консистентность и плоскость).
  - [ ] `Cast bible` (merge всех профилей).

### Сюжет
- [ ] `Plot outline` — text, свободная проза, 20 битов. Inputs: Synopsis, Theme, Cast bible, Setting, Genre. Подсказка модели — Save the Cat 15 битов растянуто до 20 за счёт сцен «дыхания».
- [ ] `Setup/Payoff registry` — text. Таблица «в бите X заложено Y, выстреливает в Z». Inputs: Plot outline, Cast bible.
- [ ] `Plot outline review` — fix-problems. Видит registry + Cast bible. Ловит orphan setups, дыры в мотивации, провалы арки.
- [ ] `llm-split` (over Plot outline) — выдаёт `textArray[20]`. Промпт: «Раздели на 20 битов, каждый бит — отдельный элемент массива».

### Первый драфт (for-each по 20 битам)
- [ ] `Scene plan` — text. Inputs: текущий бит, **весь** Plot outline, registry, Cast bible, Setting. По Свейну: Goal/Conflict/Disaster. По МакКи: смена эмоционального заряда.
- [ ] `Director notes` — text. Subtext, 2-3 sensory anchor, ключевой image, opening/closing line. **Критично на 250 словах** — нет места на разогрев.
- [ ] `Scene prose` — text. Inputs: Scene plan, Director notes, Style guide, Cast bible, Setting, **`for-each-prev-outputs` (полная проза всех предыдущих сцен)**. В промпте явно: «для continuity, не для дословного копирования стиля».
- [ ] `Scene polish` — fix-problems. Inputs: prose + Style + Cast bible + prev-outputs (для ловли сквозных повторов).
- [ ] `for-each-output` собирает 20 отполированных сцен.

### Промежуточная склейка
- [ ] `Merge first draft` — с разделителями `## Часть N`.

### Второй драфт (for-each по тем же 20 битам)
- [ ] **Каждая итерация видит весь first draft.** Это место, где включается резонансная ткань — фор-шэдоуинг, эхо, тонкая правка.
- [ ] `Scene rewrite` — text. Inputs: оригинальный Scene plan, first-draft этой сцены, **весь first draft**, Style, Cast bible.
- [ ] `Scene polish` (повторный).

### Финал
- [ ] `Merge final` — финальный текст.
- [ ] **(опционально)** Три параллельных fix-problems в режиме find-only:
  - [ ] Theme adherence — каждая сцена работает на controlling idea?
  - [ ] Continuity — имена/props/описания консистентны?
  - [ ] Voice & pacing — голос держится, темп идёт по кривой?
  - Все выдают списки замечаний пользователю, не переписывают (выходной кап не позволит).

## Ключевые промптовые гочи

- **Двухстадийный паттерн для structured output.** Если узлу нужен JSON — никогда не давать ему creative задачу с `responseSchema` сразу: модель уйдёт в compliance-mode и обрежет креатив (см. [project_json_schema_dumbs_models](.claude/projects/-home-vlsergey-github-ai-story-builder/memory/project_json_schema_dumbs_models.md)). Сначала свободный text, потом отдельный reformat-узел.
- **`for-each-prev-outputs` с полной прозой**, не summary. Резюме мы решили не использовать.
- **В Scene prose явно сказать**: «эти предыдущие сцены даны для смысловой непрерывности, не для копирования стилистики». Без этого модель залипает в повторы.
- **В Plot outline дать структурный namespace**: «Save the Cat 15 битов, растянутые до 20». Без явной структуры модель катит линейно и проваливается midpoint.
- **В Director notes требовать opening и closing line отдельно** — на 250 словах они несут половину впечатления.

## Открытые вопросы для следующей сессии

- Wizard полей: одно textarea «синопсис» — достаточно, или сразу разрешить указать genre / POV / язык отдельными полями?
- Финальный multi-axis review — включать в стартовый шаблон или собирать как опциональное расширение?
- Имена узлов: русские или английские? Русские для удобства подстановки `{{Стиль}}` в промпт, английские для consistency с системным шаблоном `simple-single-arc`.

## Когда садишься продолжать

1. Прочитать [.claude/research/fiction-arc-pipeline.md](.claude/research/fiction-arc-pipeline.md) — там обоснование решений и зависимости.
2. Прочитать [.claude/research/graph-primitives-gaps.md](.claude/research/graph-primitives-gaps.md) — что в движке готово, что нет.
3. Если retry-on-invalid-JSON для text-узлов ещё не сделан — начать с него (быстро).
4. Собирать шаблон как JSON-файл в `src/backend/resources/resources/templates/` по аналогии с `simple-single-arc.ru.json`.
5. Тестировать инкрементально: сначала подготовительный блок, потом плотный, потом сцены. Каждый блок прогонять на тестовом проекте.
