# Yandex Cloud AI — Integration Reference

## Overview

**Provider:** Yandex Cloud
**API base URL:** `https://llm.api.cloud.yandex.net`
**Authentication:**
- `Authorization: Api-Key {api_key}` — IAM API key (service account or user)
- `x-folder-id: {folder_id}` — mandatory header identifying the Yandex Cloud folder (project scope)

**Obtaining credentials:**
1. Log in to [Yandex Cloud Console](https://console.yandex.cloud)
2. Create a Service Account with `ai.languageModels.user` and `ai.files.user` roles
3. Generate an API key for the service account
4. Note the Folder ID from the console (format: `b1gXXXXXXXXXX`)

**Available models** (no `listModels` API exists — list is static):

| Model | URI path | Notes |
|---|---|---|
| YandexGPT Pro 5 | `yandexgpt/latest` | Stable, most capable |
| YandexGPT Pro 5.1 | `yandexgpt/rc` | Release candidate |
| YandexGPT Lite 5 | `yandexgpt-lite` | Fast, cheaper |
| Fine-tuned Lite | `yandexgpt-lite/latest@{suffix}` | Custom fine-tune |

Full model URI: `gpt://{folder_id}/{model_path}` — e.g. `gpt://b1g12345/yandexgpt/latest`

The Settings panel stores a user-editable list of model paths (one per line). Default: `yandexgpt/latest`, `yandexgpt/rc`, `yandexgpt-lite`. See the full current list at [aistudio.yandex.ru/docs](https://aistudio.yandex.ru/docs/ru/ai-studio/concepts/generation/models.html).

---

## Capabilities We Use

### Supported

| Capability | API Feature | Yandex Term |
|---|---|---|
| **File Upload** | `POST /files/v1/files` | Files API — upload documents (PDF, TXT, etc.) to persistent storage. Returns a `file_id`. |
| **File Attachment** | `sourceFile` reference in assistant messages | Attach file IDs to a request via the assistant run API. |
| **Knowledge Base** | `POST /searchindex/v1/searchindex` | **SearchIndex** — build a vector or hybrid index from uploaded files. Supports `TextSearchIndexType`, `VectorSearchIndexType`, `HybridSearchIndexType`. |
| **File Search (RAG)** | `SearchIndexTool` in assistant `tools` | Reference a SearchIndex as a tool; the model searches it automatically during generation. |

---

## Key Limitations

- **Strict content restrictions** — Yandex AI operates under Russian Federation law (Federal Law No. 149-FZ on Information, and related regulations). Content restrictions include:
  - LGBTQ+ topics are filtered or refused
  - Political content may be filtered
  - Offensive/adult content is blocked by default
  - These restrictions apply regardless of the age rating setting
- **SearchIndex creation is async** — Building a vector index is a deferred (async) operation. The SDK exposes `create_deferred()` which returns an operation that must be polled to completion before use.
- **Files must be re-uploaded for new index** — Updating a SearchIndex requires uploading updated files and creating a new index; there is no incremental update.
- **Regional latency** — API is hosted in Yandex Cloud regions (primarily `ru-central1`). Latency may be higher for non-CIS users.

---

## Age Rating

| Rating | Label | Meaning |
|---|---|---|
| **12+** | Teen | Yandex AI has strong default content filters. Suitable for ages 12+ per Yandex's own safety guidelines. Explicit content is not available. |

---

## API Endpoints Used

### Tokenize (used for connection test)
```
POST https://llm.api.cloud.yandex.net/foundationModels/v1/tokenize
Authorization: Api-Key {api_key}
x-folder-id: {folder_id}
Content-Type: application/json

{
  "modelUri": "gpt://{folder_id}/yandexgpt-lite/latest",
  "text": "test"
}
```
Returns token information for the given text. Used as a lightweight credential check — non-generative and cheap. Note: there is **no `listModels` endpoint** in the Yandex Foundation Models API; model URIs must be known in advance (see models list in the docs).

### File Upload
```
POST https://llm.api.cloud.yandex.net/files/v1/files
Authorization: Api-Key {api_key}
x-folder-id: {folder_id}
Content-Type: multipart/form-data

file=<binary>
mimeType=text/plain
name=lore_chapter.txt
```

### Create SearchIndex (Knowledge Base)
```
POST https://llm.api.cloud.yandex.net/searchindex/v1/searchindex
Authorization: Api-Key {api_key}
x-folder-id: {folder_id}
Content-Type: application/json

{
  "folderId": "{folder_id}",
  "name": "story-lore-index",
  "fileIds": ["file-id-1", "file-id-2"],
  "textSearchIndex": {}   // or "vectorSearchIndex": {} or "hybridSearchIndex": {}
}
```

### Foundation Models Completion with SearchIndex
```
POST https://llm.api.cloud.yandex.net/assistants/v1/runs
```
The SearchIndex is referenced as a tool in the assistant configuration. See [Yandex RAG Tutorial](https://yandex.cloud/en/docs/tutorials/ml-ai/pdf-searchindex-ai-assistant).

---

## Documentation Links

- [Yandex Foundation Models Overview](https://yandex.cloud/en/docs/foundation-models/)
- [Files API](https://yandex.cloud/en/docs/foundation-models/files/)
- [Search Index API](https://yandex.cloud/en/docs/foundation-models/searchindex/)
- [RAG with PDF + SearchIndex Tutorial](https://yandex.cloud/en/docs/tutorials/ml-ai/pdf-searchindex-ai-assistant)
- [SDK (Python/JS) on GitHub](https://github.com/yandex-cloud/yandex-cloud-ml-sdk)

---

## Files API

The Yandex Foundation Models Files API (`/files/v1/files`) provides flat object storage scoped to a Yandex Cloud organizational folder.

**No directory/folder hierarchy** — The `folder_id` in file requests refers to the Yandex Cloud billing/organizational unit, not a filesystem subdirectory. There is no way to create sub-directories. Grouping is only possible via `labels` (key-value tags).

### File metadata fields
| Field | Type | Notes |
|---|---|---|
| `folder_id` | string | Required — Yandex Cloud org folder |
| `name` | string | Human-readable display name |
| `description` | string | Optional |
| `mime_type` | string | e.g. `text/plain`, `application/pdf` |
| `content` | bytes | Binary file content |
| `labels` | map<string,string> | Key-value tags for grouping |
| `expiration_config` | ExpirationConfig | Optional TTL (`ttl_days` + policy) |

### Limits
| Limit | Value |
|---|---|
| Max file size | 128 MB |
| Files per upload batch | 100 |
| Total files per account | 10,000 |
| Files per SearchIndex | 10,000 |
| Max SearchIndexes | 1,000 per account |

## SearchIndex (Knowledge Base) — Mutability

The SearchIndex is **partially mutable**:
- **Add files**: `SearchIndexFileService.BatchCreate` — incremental, can add files to an existing index at any time.
- **Remove files**: **Not supported** — there is no delete-file-from-index operation. To remove files, the entire SearchIndex must be deleted and recreated.
- **Update metadata only**: `SearchIndexService.Update` — accepts only `name`, `description`, `expiration_config`, `labels`. Cannot change the file set or index type via Update.
- **Index type** (text/vector/hybrid) and chunking configuration are **immutable** after creation.

### Sync strategy implication
Because file removal requires full index recreation:
1. Upload new/changed lore files to Files API.
2. Delete remote files for nodes that are now empty or marked `to_be_deleted`.
3. If any file was deleted (step 2 had results) **or** there is an existing SearchIndex:
   a. Delete the old SearchIndex first (to avoid leaving orphaned indexes in the user's account).
   b. Create a new SearchIndex with all current `file_id`s.
   c. Poll the creation operation until it reaches `DONE` state (creation is async).
   d. Only after the operation completes successfully, mark `ai_sync_info[engine].last_synced_at` on all nodes and store the new `search_index_id` in project settings.
4. If only additions occurred and there is no existing index, use `SearchIndexFileService.BatchCreate` to add files, then poll for completion before marking sync as done.
5. The sync is considered **complete** only after the SearchIndex operation reaches `DONE`. If the operation fails, the sync is marked as failed and the old `search_index_id` is cleared so the next sync starts fresh.

## What We're Missing

- **JavaScript/TypeScript SDK** — Yandex has a Python SDK but the JS SDK is less mature. We use raw HTTP calls with `fetch`; full integration uses the REST API directly.
- **Async index creation** — The SearchIndex creation is asynchronous. We need to poll for completion before using the index. This adds complexity to the lore sync flow.
- **Billing API** — Yandex Cloud has a billing API, but it requires additional IAM roles (`billing.accounts.get`). The "AI & Billing" panel integration is deferred.
