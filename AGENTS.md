## Developer platform check
Determine the developer's shell environment (Bash or PowerShell). Note that PowerShell lacks standard Unix commands (e.g., head, tail) and uses different syntax for command chaining: use ; instead of &&. Ensure all generated commands are compatible with the detected shell.

## Workspace commands
The project uses npm workspaces. To run commands in a specific workspace (backend or frontend), use `npm run <script> --workspace src/backend` or `npm run <script> --workspace src/frontend` instead of changing directories with `cd`. This ensures proper dependency resolution and environment.
