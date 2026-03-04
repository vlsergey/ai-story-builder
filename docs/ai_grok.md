# Grok AI (xAI) — Integration Reference

## Overview

**Provider:** xAI
**API base URL:** `https://api.x.ai/v1` (OpenAI-compatible)
**Authentication:** `Authorization: Bearer {api_key}`
**API Keys:** Obtained from [console.x.ai](https://console.x.ai)

---

## Capabilities We Use

### Supported

| Capability | API Feature | Notes |
|---|---|---|
| **File Upload** | `POST /files` | Upload PDF, text, HTML files to persistent storage. Returns a `file_id`. |
| **File Attachment** | `attachment_search` server-side tool | Attach up to **10 file IDs** per request. xAI automatically activates the `attachment_search` tool. |

### Not Supported

| Capability | Status |
|---|---|
| **Knowledge Base / Vector Store** | Not available. Grok has no native collections/vector indexing. |
| **File Search (RAG)** | Not available. Searching across multiple files requires external RAG pipeline. |

---

## Key Limitations

- **Maximum 10 files per request** — Files attached via `attachment_search` are limited to 10 per completion call. When syncing lore, group/concatenate nodes into at most 10 files (usually by parent folder).
- **No vector/collection support** — There is no equivalent to OpenAI's Vector Stores or Yandex's SearchIndex. All context must fit within the per-request file limit.
- **File attachment is agentic** — Attaching files triggers an internal agentic workflow; Grok processes the file content before generating a response.

---

## Age Rating

| Rating | Label | Meaning |
|---|---|---|
| **NC-21** | 21+ / Adults Only | Grok is known for minimal content filtering. In unrestricted mode it can produce explicit sexual content, graphic violence, and other adult material. Treat as 21+ / Adults Only. |

---

## API Endpoints Used

### List Models (used for connection test)
```
GET https://api.x.ai/v1/models
Authorization: Bearer {api_key}
```
Returns a list of available models. Used to verify that the API key is valid.

### File Upload
```
POST https://api.x.ai/v1/files
Authorization: Bearer {api_key}
Content-Type: multipart/form-data

file=<binary>
purpose=assistants
```

### Chat Completion with File Attachments
```
POST https://api.x.ai/v1/chat/completions
Authorization: Bearer {api_key}
Content-Type: application/json

{
  "model": "grok-2",
  "messages": [...],
  "file_ids": ["file-abc123", ...]   // up to 10 files
}
```

---

## Documentation Links

- [xAI Files Guide](https://docs.x.ai/docs/guides/files)
- [xAI API Reference](https://docs.x.ai/api)
- [xAI Models](https://docs.x.ai/docs/models)

---

## What We're Missing

- **Vector/Collection Search** — Grok does not support grouping files into a searchable collection. If we need RAG-style retrieval across many lore files, we would need an external vector database (Pinecone, Chroma, etc.) or switch to Yandex.
- **Balance/Billing API** — xAI does not currently expose a billing/balance API. The "AI & Billing" panel cannot show live balance for Grok.
