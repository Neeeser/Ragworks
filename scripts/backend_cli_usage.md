# Backend CLI Quickstart

Use these commands to drive the TransparentRAG backend end-to-end. Replace placeholder IDs/emails with your own values.

## Bootstrap
- **Run API** (env vars set with OpenRouter/Pinecone secrets): `uvicorn app.api.main:app --reload`
- **Ping from CLI** (defaults to `http://127.0.0.1:8000`): `./.venv/bin/python -m scripts.backend_cli health`

## Auth
1. Register + login, caching the JWT:  
   `./.venv/bin/python -m scripts.backend_cli auth register --email you@example.com --password 'Str0ng!Pass' --full-name "CLI Tester" --login`
2. Later logins reuse the state file. To re-authenticate explicitly:  
   `./.venv/bin/python -m scripts.backend_cli auth login --email you@example.com --password 'Str0ng!Pass'`
3. Verify identity:  
   `./.venv/bin/python -m scripts.backend_cli auth me`

## Collections
1. List existing collections:  
   `./.venv/bin/python -m scripts.backend_cli collections list`
2. Create one with explicit chunk + metadata settings:  
   `./.venv/bin/python -m scripts.backend_cli collections create --name "CLI Collection" --description "From CLI" --chunk-strategy token --chunk-size 512 --chunk-overlap 64 --metadata project=demo --metadata tier=dev`
3. Note the printed `id` for later commands. Show details anytime:  
   `./.venv/bin/python -m scripts.backend_cli collections show --collection-id <COL_ID>`

## Documents
- Upload fixtures (adjust paths/types as needed):  
  `./.venv/bin/python -m scripts.backend_cli documents upload --collection-id <COL_ID> --file tests/assets/sample.txt --content-type text/plain`  
  `./.venv/bin/python -m scripts.backend_cli documents upload --collection-id <COL_ID> --file tests/assets/sample.pdf --content-type application/pdf`
- List ingested documents:  
  `./.venv/bin/python -m scripts.backend_cli documents list --collection-id <COL_ID>`
- Inspect stored chunks for one document:  
  `./.venv/bin/python -m scripts.backend_cli documents chunks --document-id <DOC_ID>`

## Retrieval & Chat
- Plain semantic query:  
  `./.venv/bin/python -m scripts.backend_cli collections query --collection-id <COL_ID> --text "What is TransparentRAG?" --top-k 5`
- Start a chat turn (creates a session):  
  `./.venv/bin/python -m scripts.backend_cli collections chat --collection-id <COL_ID> --message "Summarize the docs with citations." --title "CLI Demo"`
- Continue an existing session:  
  `./.venv/bin/python -m scripts.backend_cli collections chat --collection-id <COL_ID> --session-id <SESSION_ID> --message "Give me bullet points."`

## Sessions & History
- List chat sessions for a collection:  
  `./.venv/bin/python -m scripts.backend_cli sessions list --collection-id <COL_ID>`
- Show the full tool/message history:  
  `./.venv/bin/python -m scripts.backend_cli sessions history --session-id <SESSION_ID>`

## Extras
- Browse cached OpenRouter models (force refresh + limit output):  
  `./.venv/bin/python -m scripts.backend_cli models --limit 10 --refresh`
- Need raw payloads for scripting? Append `--json` to any command, e.g.  
  `./.venv/bin/python -m scripts.backend_cli collections list --json`
