## Use cases

### Coding & project organization
* The codebase must be cleanly structured; backend logic should not live in a single file.  
  Each entity (projects, folders, lore, plan, generated parts, etc.) should have its own directory under `src/backend` and individual endpoints implemented in separate files.  
  These modular routes are then imported by a central router.  
* UI components should follow the design system and be properly styled (no bare black text on white).  Dockable panels must support drag‑and‑drop and resizing interactions, not just static flexboxes.
* **Session Management**: The server maintains global state about which database is currently open. All API endpoints use this server-side state rather than requiring database path parameters with each request. This simplifies the API and ensures consistency across all requests within a session.
  * The `/api/project/status` endpoint reports whether a project is currently open on the server
  * The `/api/project/close` endpoint closes the current project session
  * All data endpoints (folders, lore items, plan nodes, etc.) automatically operate on the current open database
* **URL Routing**: The application URL does NOT contain the database path. Session state is managed entirely on the server. Reloading the page will preserve the current project by checking server state on application startup.
* Frontend communicates with the backend API without passing database paths; the backend tracks the session state and all requests automatically use the currently open database.


### UI
* Browser with UI should be opened automatically on application startup (defaults to the frontend on port 3000 with hot reload in development mode)
* On start user should have an ability to select translation (RUS/ENG at least). Translations are stored separately (i.e. there should be files like "Russian" and "English" that contain all MUI-strings.)
* Create new project option: user can create a new project (new SQLite DB) from the Start screen. On creation the app initializes default folders (locations, abilities, spells, bestiary, characters) and a root "Story Lore" folder. If a database with the chosen name already exists, the application should simply open that existing project instead of creating a duplicate file.
* On application startup, the UI automatically determines if a project is already open on the server:
  * If open, the main layout is displayed with the project ready to work on
  * If not open, the Start screen is shown for project selection
* **File Menu**: Available when a project is open, provides:
  * Close Project: closes the current project and returns to the Start screen
  * Quit: closes the project and attempts to exit the application (browser window close, or process termination for desktop apps)
* **View Menu**: Available when a project is open, provides:
  * **Settings**: opens the Settings panel in the editor group (singleton)
  * Reset layouts: restores the default dock/panel layout configuration
  * Theme selection: choose between available themes (Zinc, Slate, Neutral, Obsidian, Carbon)
* UI organized as dockable interface with areas (specified sizes are default, actual values stored in project database):
    * Left side (30%): Lore; Story plan tree (tree views must be rendered with proper styling, not plain text; see design requirements for visually clear, indented node lists).
    * Panels should visually display borders and separate areas using the chosen design system, and in future support drag–drop docking/resizing using a proper layout library rather than static divs.
* The UI must use URL routes for navigation. Reloading the page preserves the current project by checking server state (no URL parameters required for session management).
    * Central part (40%): Story part editor / MD-editor
    * Right part (30%): Cards definitions list / cards list
    * Bottom part: Logs / progress / AI & Billing panel (dockable, default position near logs)

#### UI Panel Requirements
* The following panels must be non-closable: Lore, Plan, and Cards
* The left column panels must be ordered with Lore above Plan by default, but Plan can be positioned below Lore
* The theme background must be consistent across all panels with no white borders around dark layouts
* All panels must maintain their dockable, resizable, and movable properties

### AI Backends and Billing
* Separate dockable panel "AI & Billing" (default near logs)
* User can switch between backends: Grok API, Yandex Cloud AI, Local Model, Mock: Grok AI Chat, Mock: Yandex AI Chat
* API keys are saved in project database only if "Save API keys" checkbox is enabled (disabled by default)
* Real balance and spending information is shown from Billing API (for Grok and Yandex)
* On any AI backend error a dialog appears with detailed error message (copy-paste enabled for reporting) and buttons: Abort, Retry, Ignore (Ignore continues in Mock mode)

### Settings Panel
* Accessible via **View > Settings** in the application menu
* Opens as a dockable tab in the **editor group** (center area) by default; can be moved to any area and returned to the editor group
* Settings panel is a **singleton** — reopening it activates the existing tab rather than opening a duplicate
* **Current AI Engine** selector: choose from predefined engines (Grok AI, Yandex Cloud AI) or custom user-defined engines; "None" option is always available
  * Selecting an engine validates required credentials are saved; shows inline validation error if required fields are missing
  * Changing the active engine emits an `AI_ENGINE_CHANGED_EVENT` so the Lore Tree sync icon updates immediately
* **Per-engine configuration sections**, one per supported engine:
  * Credential fields (API key, folder ID, etc.) — auto-saved on blur or Enter key
  * Password fields with Show/Hide toggle
  * **Test Connection** button — sends current form values (possibly unsaved) to backend test endpoint; shows spinner → result (Connected / error)
  * **Capabilities list** — shows which features the engine supports (see below)
  * **Age rating badge** — shows the engine's content maturity rating (see below)
* **Model selection is NOT part of engine configuration** — the specific model for each operation (generation, plan, story cards) is chosen per-operation, not stored in the engine settings. This allows using different models on the same engine for different tasks.

#### AI Engine Capabilities

Each AI engine has a defined set of capabilities. Capabilities are fixed for built-in engines and user-selectable for custom engines:

| Capability | Description |
|---|---|
| **File Upload** | Upload documents (PDF, TXT, etc.) to persistent AI storage for reuse across requests |
| **File Attachment** | Reference an uploaded file in a specific request so the model can read it directly |
| **Knowledge Base** | Build a searchable vector/hybrid index from uploaded files (RAG — Retrieval-Augmented Generation). Also called: Vector Store (OpenAI), Collection (xAI), SearchIndex (Yandex) |
| **File Search** | Reference a Knowledge Base in a request so the model automatically searches it for relevant context. Also called: file_search (OpenAI), collections_search (xAI), Search Index Tool (Yandex) |

Built-in engine capabilities:
* **Grok AI**: File Upload ✓, File Attachment ✓, Knowledge Base ✗, File Search ✗ — max 10 files per request
* **Yandex Cloud AI**: File Upload ✓, File Attachment ✓, Knowledge Base ✓, File Search ✓

#### Age Rating System

Each AI engine has a content maturity rating indicating what kind of content the engine may produce:

| Rating | Label | Description |
|---|---|---|
| `G`    | All Ages  | Completely family-safe content only |
| `PG`   | 7+        | Parental guidance; mild themes |
| `12`   | 12+       | Teen-appropriate; standard assistant-level content |
| `16`   | 16+       | Mature themes; no explicit content |
| `18`   | 18+       | Adult content; explicit material possible |
| `NC21` | NC-21     | Unrestricted adult content (21+) |

Built-in ratings: **Grok AI = NC-21**, **Yandex Cloud AI = 12+**
Custom engines: age rating is user-selectable.
Age rating is displayed as a colored badge in the Settings panel and is informational only (no enforcement).

### Instances, sessions, databases
* Each instance of application supports single session (single connected database) related to single project
* Server maintains global state about which database is currently open. All API requests automatically use this open database without requiring the database path to be passed with each request.
* On application startup (or page refresh), the UI checks the server status to determine if a project is already open:
  * If a database is open on the server, the UI automatically loads the main layout with that project
  * If no database is open, the UI displays the Start screen for project selection
* On startup user can select to:
    * open one of 3-5 recent used projects (databases)
    * open any SQLite project file present in the projects folder (listed on the Start screen)
* When a project is opened, the server state is updated to track that database as the current session
* Before opening database file a backup should be created. System should maintain up to 7 file backups (may be changed in app config)
* On opening file version check should be performed (i.e. Liquibase schema version check). If old version is detected confirmation should be asked to upgrade file to latest (current) version of db schema. On decline database should be closed and UI returned to project selection
* During usual work with project user can:
  * Close the current project via the "File" menu → "Close Project" option, which returns to the Start screen
  * Quit the application via the "File" menu → "Quit" option, which closes the server session and attempts to close the browser window
  * Open a different project (which closes the previous one and opens a new one)
* URL routing preserves the project state: reloading the page will reconnect to the same open project via server state, not via URL parameters
* There should be an option to export project (all latest versions of texts) to zip/folder as MD files.

### Lore
Lore of story is stable collection of text organized in folders. Some folders will be created on new project creation, like: locations, abilities, spells, bestiary, characters. There is always a root folder "Story Lore" (can't delete or move it). User can:
* create new folder
* move folder (using drag-drop)
* rename folder (inline in the tree via F2 or Rename button)
* delete folder (ask for confirmation)
* create new file in folder (opens inline rename immediately)
* import (upload) files to directory (via Import button in toolbar)
* export one or more lore items as text files (via Export button in toolbar)
* rename file
* open lore item editor (double-click, Enter, or Edit button in toolbar)
* select multiple files to do batch operations: move/delete/export/drop

#### Lore Editor Tab
Opening a lore item (double-click / Enter / toolbar Edit button) opens a dedicated editor tab in the **central panel group** (where the watermark is shown initially). Multiple lore items can be open simultaneously as separate tabs. Re-opening an already-open item activates its existing tab.

The lore editor tab contains:
* **Title field** — single-line input showing the node name. Changes are auto-saved with a ~1 s debounce (no Save button required). Saving the title also updates the dockview tab label.
* **Content field** — full-height CodeMirror 6 editor with Markdown syntax highlighting. Supports dark and light themes matching the application theme. Changes are auto-saved with a ~1 s debounce. Content is stored in `lore_nodes.content`.
* **Save indicator** — "Saved" / "Saving…" label in the title bar.

The Lore panel has a toolbar with the following icon buttons:
* **Create child node** — active when exactly one node is selected; creates a child with a unique default name and immediately starts inline rename
* **Duplicate** — active when one non-root node is selected
* **Rename (F2)** — active when one node is selected; starts inline rename in the tree
* **Open editor (Enter)** — active when one node is selected; opens the editor tab
* **Sort children A→Z** — active when at least one selected node has more than one child
* **Import** — active when exactly one node is selected; imports a file as a new child lore item
* **Export** — active when at least one lore item with content is selected; downloads selected items as text files
* **Delete / Restore** — active when at least one element is selected; marks selected items as `to_be_deleted = 1` (soft-delete, shown as strikethrough). When all selected items are already marked for deletion, the button switches to **Restore** which clears the flag. Cascades to all descendants.
* **Sync with AI Engine** — always active; synchronises all lore with the selected AI Engine and permanently removes items marked for deletion. Actual behavior depends on engine:
  * Yandex Cloud AI: upload files to collection / vector storage (replacing existing)
  * Grok AI: group/concatenate files up to 10 files (usually by folders) and upload as files (remembering IDs)
* Each lore item should have status: DRAFT (not uploaded to AI engine) / UPLOADED. This status will be different to each supported AI engine (stored separately).
* When folder or file is deleted locally, it is removed from AI server (Grok/Yandex) during the next lore synchronization.
* All lore files will be added to all requests to AI (usually using references).

### Story plan
* Story plan is also a tree. Each node defines story at some level. Root node describes story as a whole.
* Each non-leaf node defines structure of child node (i.e. in which form plan should be stored).
* Each node of story plan (both plan node and story part node) has some instructions text. Mandatory for root node. This instruction is used to regenerate both plan for specific story plan node and, may be, for child nodes generation. If node in DRAFT state, we just change instruction in database. If node in GENERATED state, new version with DRAFT state will be created (as copy of latest in GENERATED state).
* There should be a mark that current plan node has changes in instructions that are not reflected in story plan generation result (i.e. state indicator)
* There should be a button to regenerate plan node (with all subchildren) using new version of instruction. Success regeneration fills node story plan result AND changes state to GENERATED
* When regenerating whole plan or large subtree user should be asked for confirmation
* Visual diff should be available for: plan node instructions and plan node result (with possibility to restore previous version)

### Story parts
* Each story plan node has an action to (re)generate story part. Every success generation will result in new story part version creation with GENERATED state.
* Each story part can be also opened in MD editor and edited manually (state of version is changed to EDITED). Manual editing does not block possibility of regeneration.
* For story part generation we send to AI: lore files references, story plan instructions, current story cards.
* After story part generation we automatically also ask AI to update story cards (i.e. generate story cards linked to generated story part with updates)
* Visual diff should be available for: story part instructions and story part result (with possibility to restore previous version)

### Story cards
Story cards describe state of something changeable in story. For example some hero inventory, his status, or, for example, who presents in some location (in EVERY part of the story)

* User may define number of story cards, including their structure (what shall be included in card) in free text form.
* New collection of story card is linked to story part AND her version. I.e. generating new story part (or new version of story part) will result in new story part cards generation.
* So in story cards we have two tabs: definitions and actual values
* On actual values tab we have select box that allows to select from which story part we are interested to see cards from.
* There should be a switch in UI that syncs cards view and story plan / parts selection.
* History of card versions should be available with visual diff and possibility to restore previous version (for actual values)
* Visual diff should also be available for cards definitions when they are changed.

### Fast actions
* Sync all lore
* Generate / regenerate plan
* Generate next story part
* Update cards for current story part
