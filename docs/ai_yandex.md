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

### List Models (used for connection test)
```
GET https://llm.api.cloud.yandex.net/foundationModels/v1/listModels
Authorization: Api-Key {api_key}
x-folder-id: {folder_id}
```
Returns a list of available foundation models. Used to verify that credentials are valid.

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

## What We're Missing

- **JavaScript/TypeScript SDK** — Yandex has a Python SDK but the JS SDK is less mature. We use raw HTTP calls with `fetch` for the connection test; full integration will require either the REST API directly or the JS SDK.
- **Async index creation** — The SearchIndex creation is asynchronous. We need to poll for completion before using the index. This adds complexity to the lore sync flow.
- **Incremental sync** — There is no way to update individual files in an existing SearchIndex. Full re-upload and re-indexing is required when lore changes.
- **Billing API** — Yandex Cloud has a billing API, but it requires additional IAM roles (`billing.accounts.get`). The "AI & Billing" panel integration is deferred.
