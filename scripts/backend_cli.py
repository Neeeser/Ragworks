#!/usr/bin/env python
"""Command-line helper for exercising the Ragworks backend."""
from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import httpx

DEFAULT_BASE_URL = "http://127.0.0.1:8000"
ENV_BASE_URL = os.getenv("RAGWORKS_API_BASE")
ENV_TOKEN = os.getenv("RAGWORKS_TOKEN")
ENV_STATE_PATH = os.getenv("RAGWORKS_STATE_PATH")
DEFAULT_STATE_PATH = Path(ENV_STATE_PATH) if ENV_STATE_PATH else Path.home() / ".ragworks-cli-state.json"


def load_state(path: Path) -> Dict[str, Any]:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return {}
    return {}


def save_state(path: Path, state: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")


def parse_metadata(pairs: Optional[Iterable[str]]) -> Dict[str, str]:
    metadata: Dict[str, str] = {}
    if not pairs:
        return metadata
    for raw in pairs:
        if "=" not in raw:
            raise SystemExit(f"Metadata entries must be KEY=VALUE, got '{raw}'.")
        key, value = raw.split("=", 1)
        metadata[key.strip()] = value.strip()
    return metadata


def truncate(text: str, limit: int = 140) -> str:
    clean = " ".join(text.split())
    if len(clean) <= limit:
        return clean
    return clean[: limit - 3] + "..."


def format_metadata(metadata: Dict[str, Any]) -> str:
    if not metadata:
        return ""
    parts = [f"{key}={metadata[key]}" for key in sorted(metadata)]
    return ", ".join(parts)


def print_usage(usage: Dict[str, Any]) -> None:
    if not usage:
        return
    prompt = usage.get("prompt_tokens") or usage.get("prompt")
    completion = usage.get("completion_tokens") or usage.get("completion")
    total = usage.get("total_tokens") or usage.get("total")
    usage_bits = []
    if prompt is not None:
        usage_bits.append(f"prompt={prompt}")
    if completion is not None:
        usage_bits.append(f"completion={completion}")
    if total is not None:
        usage_bits.append(f"total={total}")
    if not usage_bits:
        usage_bits = [json.dumps(usage)]
    print(f"Usage: {' · '.join(usage_bits)}")


def print_collections(collections: List[Dict[str, Any]]) -> None:
    if not collections:
        print("No collections found.")
        return
    for collection in collections:
        chunk = collection.get("chunk_settings", {}) or {}
        metadata = collection.get("metadata") or {}
        print(f"- {collection['name']} ({collection['id']})")
        print(
            f"    embed={collection['embedding_model']} · chat={collection['chat_model']} · namespace={collection['pinecone_namespace']}"
        )
        print(
            f"    chunks: strategy={chunk.get('strategy')} size={chunk.get('chunk_size')} overlap={chunk.get('chunk_overlap')}"
        )
        if metadata:
            print(f"    metadata: {format_metadata(metadata)}")


def print_documents(documents: List[Dict[str, Any]]) -> None:
    if not documents:
        print("No documents found.")
        return
    for doc in documents:
        print(f"- {doc['name']} ({doc['id']}) status={doc['status']} chunks={doc['num_chunks']}")
        print(
            f"    type={doc['content_type']} strategy={doc['chunk_strategy']} size={doc['chunk_size']} overlap={doc['chunk_overlap']}"
        )


def print_document_chunks(payload: Dict[str, Any]) -> None:
    document = payload.get("document", {})
    chunks = payload.get("chunks", [])
    if document:
        print(f"Document {document.get('name')} ({document.get('id')}) chunks={len(chunks)}")
    for chunk in chunks:
        snippet = truncate(chunk.get("text", ""), 160)
        print(
            f"- #{chunk.get('chunk_index')} chunk_id={chunk.get('id')} size={chunk.get('chunk_size')} strategy={chunk.get('chunk_strategy')}"
        )
        print(f"    text: {snippet}")
        metadata = chunk.get("metadata") or {}
        if metadata:
            print(f"    metadata: {format_metadata(metadata)}")


def print_query_result(result: Dict[str, Any]) -> None:
    print(f"Query: \"{result.get('query')}\" (top_k={result.get('top_k')})")
    chunks = result.get("chunks", [])
    if not chunks:
        print("No chunks returned.")
    for idx, chunk in enumerate(chunks, start=1):
        score = chunk.get("score")
        score_text = f"{score:.4f}" if isinstance(score, (int, float)) else "n/a"
        print(
            f"[{idx}] score={score_text} doc={chunk.get('document_id')} chunk={chunk.get('chunk_id')}"
        )
        print(f"    text: {truncate(chunk.get('text', ''), 200)}")
        metadata = chunk.get("metadata") or {}
        if metadata:
            print(f"    metadata: {format_metadata(metadata)}")
    usage = result.get("usage") or {}
    print_usage(usage)


def print_chat_response(response: Dict[str, Any]) -> None:
    session = response.get("session") or {}
    print(
        "Session "
        f"{session.get('id')} · collection={session.get('collection_id')} · model={session.get('chat_model')} "
        f"· context={response.get('context_consumed')}/{response.get('context_window')}"
    )
    messages = response.get("messages", [])
    for message in messages[-6:]:
        model = message.get("model") or "-"
        role = str(message.get("role")).upper()
        print(f"{role:>10} [{model}] {truncate(message.get('content', ''), 160)}")
    tool_traces = response.get("tool_traces") or []
    if tool_traces:
        print("Tool calls:")
        for trace in tool_traces:
            args_preview = truncate(json.dumps(trace.get("arguments"), default=str), 120)
            print(f"  - {trace.get('name')}({args_preview}) -> {truncate(json.dumps(trace.get('response')), 120)}")
    usage = response.get("usage") or {}
    print_usage(usage)


def print_sessions(sessions: List[Dict[str, Any]]) -> None:
    if not sessions:
        print("No chat sessions recorded.")
        return
    for session in sessions:
        print(
            f"- {session['id']} title=\"{session['title']}\" mode={session['mode']} "
            f"model={session['chat_model']} updated={session['updated_at']}"
        )


def print_chat_history(messages: List[Dict[str, Any]]) -> None:
    if not messages:
        print("Chat history is empty.")
        return
    for message in messages:
        role = str(message.get("role")).upper()
        model = message.get("model") or "-"
        stamp = message.get("created_at")
        print(f"{stamp} · {role} [{model}]")
        print(f"    {message.get('content')}")
        if message.get("tool_name"):
            print(f"    tool={message['tool_name']} payload={message.get('tool_payload')}")
        usage_bits = {}
        if message.get("prompt_tokens"):
            usage_bits["prompt"] = message["prompt_tokens"]
        if message.get("completion_tokens"):
            usage_bits["completion"] = message["completion_tokens"]
        if usage_bits:
            print(f"    usage={usage_bits}")


class BackendClient:
    def __init__(self, base_url: str, token: Optional[str] = None) -> None:
        self._base_url = (base_url or "").rstrip("/") or DEFAULT_BASE_URL
        self.token = token
        timeout = httpx.Timeout(60.0, connect=10.0)
        self._client = httpx.Client(base_url=self._base_url, timeout=timeout)

    def __enter__(self) -> "BackendClient":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

    @property
    def base_url(self) -> str:
        return self._base_url

    def set_token(self, token: Optional[str]) -> None:
        self.token = token

    def close(self) -> None:
        self._client.close()

    def request(
        self,
        method: str,
        path: str,
        *,
        json_body: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
        files: Optional[Dict[str, Any]] = None,
        require_auth: bool = True,
    ) -> Any:
        url_path = path if path.startswith("/") else f"/{path}"
        headers: Dict[str, str] = {}
        if require_auth:
            if not self.token:
                raise SystemExit("This command requires authentication. Run `auth login` first.")
            headers["Authorization"] = f"Bearer {self.token}"
        try:
            response = self._client.request(
                method.upper(),
                url_path,
                json=json_body,
                data=data,
                files=files,
                headers=headers,
            )
        except httpx.RequestError as exc:
            raise SystemExit(f"Failed to reach {self._base_url}{url_path}: {exc}") from exc
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = extract_error_detail(exc.response)
            raise SystemExit(f"{exc.response.status_code} {exc.response.reason_phrase}: {detail}") from exc
        if response.status_code == 204:
            return None
        if not response.content:
            return None
        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            return response.json()
        return response.text

    def get(self, path: str, *, require_auth: bool = True) -> Any:
        return self.request("GET", path, require_auth=require_auth)

    def post(
        self,
        path: str,
        *,
        json_body: Optional[Dict[str, Any]] = None,
        data: Optional[Dict[str, Any]] = None,
        files: Optional[Dict[str, Any]] = None,
        require_auth: bool = True,
    ) -> Any:
        return self.request(
            "POST",
            path,
            json_body=json_body,
            data=data,
            files=files,
            require_auth=require_auth,
        )


def extract_error_detail(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text
    if isinstance(payload, dict):
        detail = payload.get("detail")
        if detail:
            if isinstance(detail, dict):
                return json.dumps(detail)
            return str(detail)
    return json.dumps(payload)


def perform_login(
    *,
    email: str,
    password: str,
    client: BackendClient,
    state: Dict[str, Any],
    state_path: Path,
) -> Dict[str, Any]:
    token_payload = client.post(
        "/api/auth/token",
        data={"username": email, "password": password},
        require_auth=False,
    )
    access_token = token_payload.get("access_token")
    if not access_token:
        raise SystemExit("Login response missing access_token.")
    client.set_token(access_token)
    user = client.get("/api/auth/me")
    state.update(
        {
            "base_url": client.base_url,
            "token": access_token,
            "token_type": token_payload.get("token_type", "bearer"),
            "user": user,
            "email": email,
        }
    )
    save_state(state_path, state)
    return user


def cmd_register(args, client: BackendClient, state: Dict[str, Any], state_path: Path) -> Dict[str, Any]:
    payload = {"email": args.email, "password": args.password, "full_name": args.full_name}
    user = client.post("/api/auth/register", json_body=payload, require_auth=False)
    print(f"Registered user {user['email']} (id={user['id']}).")
    state.update({"user": user, "email": user["email"], "base_url": client.base_url})
    save_state(state_path, state)
    if args.login:
        login_user = perform_login(email=args.email, password=args.password, client=client, state=state, state_path=state_path)
        print(f"Authenticated as {login_user['email']}. Token saved to {state_path}.")
        return login_user
    return user


def cmd_login(args, client: BackendClient, state: Dict[str, Any], state_path: Path) -> Dict[str, Any]:
    user = perform_login(email=args.email, password=args.password, client=client, state=state, state_path=state_path)
    print(f"Authenticated as {user['email']}. Token saved to {state_path}.")
    return {"user": user, "token": state.get("token")}


def cmd_me(args, client: BackendClient, _state: Dict[str, Any], _state_path: Path) -> Dict[str, Any]:
    user = client.get("/api/auth/me")
    if not args.json:
        print(f"Current user: {user['email']} (id={user['id']})")
    return user


def cmd_collections_list(args, client: BackendClient, _state: Dict[str, Any], _state_path: Path) -> List[Dict[str, Any]]:
    collections = client.get("/api/collections")
    if not args.json:
        print_collections(collections)
    return collections


def cmd_collections_show(args, client: BackendClient, _state: Dict[str, Any], _state_path: Path) -> Dict[str, Any]:
    collection = client.get(f"/api/collections/{args.collection_id}")
    if not args.json:
        print_collections([collection])
    return collection


def cmd_collections_create(args, client: BackendClient, _state: Dict[str, Any], _state_path: Path) -> Dict[str, Any]:
    metadata = parse_metadata(args.metadata)
    chunk_settings: Dict[str, Any] = {}
    if args.chunk_strategy:
        chunk_settings["strategy"] = args.chunk_strategy
    if args.chunk_size:
        chunk_settings["chunk_size"] = args.chunk_size
    if args.chunk_overlap is not None:
        chunk_settings["chunk_overlap"] = args.chunk_overlap
    payload: Dict[str, Any] = {
        "name": args.name,
        "description": args.description,
    }
    if metadata:
        payload["metadata"] = metadata
    if args.embedding_model:
        payload["embedding_model"] = args.embedding_model
    if args.chat_model:
        payload["chat_model"] = args.chat_model
    if args.pinecone_namespace:
        payload["pinecone_namespace"] = args.pinecone_namespace
    if chunk_settings:
        payload["chunk_settings"] = chunk_settings
    collection = client.post("/api/collections", json_body=payload)
    if not args.json:
        print("Created collection:")
        print_collections([collection])
    return collection


def cmd_collections_query(args, client: BackendClient, _state: Dict[str, Any], _state_path: Path) -> Dict[str, Any]:
    payload = {"query": args.text, "top_k": args.top_k}
    result = client.post(f"/api/collections/{args.collection_id}/query", json_body=payload)
    if not args.json:
        print_query_result(result)
    return result


def cmd_collections_chat(args, client: BackendClient, _state: Dict[str, Any], _state_path: Path) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "content": args.message,
        "mode": args.mode,
        "title": args.title,
    }
    if args.session_id:
        payload["session_id"] = args.session_id
    response = client.post(f"/api/collections/{args.collection_id}/chat", json_body=payload)
    if not args.json:
        print_chat_response(response)
    return response


def cmd_documents_list(args, client: BackendClient, _state: Dict[str, Any], _state_path: Path) -> List[Dict[str, Any]]:
    documents = client.get(f"/api/collections/{args.collection_id}/documents")
    if not args.json:
        print_documents(documents)
    return documents


def cmd_documents_upload(args, client: BackendClient, _state: Dict[str, Any], _state_path: Path) -> Dict[str, Any]:
    file_path = Path(args.file)
    if not file_path.exists():
        raise SystemExit(f"File not found: {file_path}")
    content_type = args.content_type or mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
    with file_path.open("rb") as handle:
        response = client.post(
            f"/api/collections/{args.collection_id}/documents",
            files={"file": (file_path.name, handle, content_type)},
        )
    if not args.json:
        document = response.get("document", {})
        print(f"Uploaded {file_path.name} -> document_id={document.get('id')} chunks={response.get('chunk_count')}")
        print(f"Embedding model: {response.get('embedding_model')}")
        usage = response.get("usage") or {}
        print_usage(usage)
    return response


def cmd_documents_chunks(args, client: BackendClient, _state: Dict[str, Any], _state_path: Path) -> Dict[str, Any]:
    payload = client.get(f"/api/documents/{args.document_id}/chunks")
    if not args.json:
        print_document_chunks(payload)
    return payload


def cmd_sessions_list(args, client: BackendClient, _state: Dict[str, Any], _state_path: Path) -> List[Dict[str, Any]]:
    sessions = client.get(f"/api/collections/{args.collection_id}/sessions")
    if not args.json:
        print_sessions(sessions)
    return sessions


def cmd_sessions_history(args, client: BackendClient, _state: Dict[str, Any], _state_path: Path) -> List[Dict[str, Any]]:
    messages = client.get(f"/api/chat/sessions/{args.session_id}")
    if not args.json:
        print_chat_history(messages)
    return messages


def cmd_models_list(args, client: BackendClient, _state: Dict[str, Any], _state_path: Path) -> Dict[str, Any]:
    route = "/api/models?kind=chat"
    if args.refresh:
        route += "&refresh=true"
    payload = client.get(route)
    models = payload.get("models", [])
    if not args.json:
        for model in models[: args.limit or len(models)]:
            print(
                f"- {model['id']} provider={model.get('provider_type')} ctx={model.get('context_length')} price={(model.get('pricing') or {}).get('prompt')}"
            )
        if args.limit and len(models) > args.limit:
            print(f"... truncated to {args.limit} models. Use --limit 0 for full list.")
    return payload


def cmd_health(args, client: BackendClient, _state: Dict[str, Any], _state_path: Path) -> Dict[str, Any]:
    payload = client.get("/api/health", require_auth=False)
    if not args.json:
        print(f"Health: {payload}")
    return payload


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="CLI smoke tester for the Ragworks backend.")
    parser.add_argument("--base-url", help="API base URL (defaults to env/state or http://127.0.0.1:8000).")
    parser.add_argument("--token", help="Override JWT access token for this invocation.")
    parser.add_argument(
        "--state-path",
        type=Path,
        default=DEFAULT_STATE_PATH,
        help=f"Where to store cached token/user info (default: {DEFAULT_STATE_PATH}).",
    )
    parser.add_argument("--json", action="store_true", help="Print raw JSON responses.")

    subparsers = parser.add_subparsers(dest="command", required=True)

    # Auth commands
    auth_parser = subparsers.add_parser("auth", help="Authentication helpers.")
    auth_sub = auth_parser.add_subparsers(dest="auth_command", required=True)

    register = auth_sub.add_parser("register", help="Register a new user.")
    register.add_argument("--email", required=True)
    register.add_argument("--password", required=True)
    register.add_argument("--full-name", dest="full_name", required=True)
    register.add_argument("--login", action="store_true", help="Immediately log in after registration.")
    register.set_defaults(func=cmd_register)

    login = auth_sub.add_parser("login", help="Authenticate and cache a JWT.")
    login.add_argument("--email", required=True)
    login.add_argument("--password", required=True)
    login.set_defaults(func=cmd_login)

    me = auth_sub.add_parser("me", help="Show the current authenticated user.")
    me.set_defaults(func=cmd_me)

    # Collections
    col_parser = subparsers.add_parser("collections", help="Manage RAG collections.")
    col_sub = col_parser.add_subparsers(dest="collections_command", required=True)

    col_list = col_sub.add_parser("list", help="List collections for the current user.")
    col_list.set_defaults(func=cmd_collections_list)

    col_show = col_sub.add_parser("show", help="Show collection details.")
    col_show.add_argument("--collection-id", required=True)
    col_show.set_defaults(func=cmd_collections_show)

    col_create = col_sub.add_parser("create", help="Create a new collection.")
    col_create.add_argument("--name", required=True)
    col_create.add_argument("--description", default="")
    col_create.add_argument("--embedding-model")
    col_create.add_argument("--chat-model")
    col_create.add_argument("--pinecone-namespace")
    col_create.add_argument("--chunk-strategy", choices=["token", "sentence", "paragraph", "semantic"])
    col_create.add_argument("--chunk-size", type=int)
    col_create.add_argument("--chunk-overlap", type=int)
    col_create.add_argument("--metadata", action="append", metavar="KEY=VALUE")
    col_create.set_defaults(func=cmd_collections_create)

    col_query = col_sub.add_parser("query", help="Run a semantic query against a collection.")
    col_query.add_argument("--collection-id", required=True)
    col_query.add_argument("--text", required=True, help="Natural language query.")
    col_query.add_argument("--top-k", type=int, default=5)
    col_query.set_defaults(func=cmd_collections_query)

    col_chat = col_sub.add_parser("chat", help="Send a chat message (RAG) to a collection.")
    col_chat.add_argument("--collection-id", required=True)
    col_chat.add_argument("--message", required=True)
    col_chat.add_argument("--session-id", help="Existing session UUID to continue.")
    col_chat.add_argument("--title", help="Optional session title.")
    col_chat.add_argument("--mode", choices=["chat", "query"], default="chat")
    col_chat.set_defaults(func=cmd_collections_chat)

    # Documents
    doc_parser = subparsers.add_parser("documents", help="Document ingestion helpers.")
    doc_sub = doc_parser.add_subparsers(dest="documents_command", required=True)

    doc_list = doc_sub.add_parser("list", help="List documents in a collection.")
    doc_list.add_argument("--collection-id", required=True)
    doc_list.set_defaults(func=cmd_documents_list)

    doc_upload = doc_sub.add_parser("upload", help="Upload a file for ingestion.")
    doc_upload.add_argument("--collection-id", required=True)
    doc_upload.add_argument("--file", required=True, help="Path to the file to ingest.")
    doc_upload.add_argument("--content-type", help="Override detected MIME type.")
    doc_upload.set_defaults(func=cmd_documents_upload)

    doc_chunks = doc_sub.add_parser("chunks", help="Inspect stored chunks for a document.")
    doc_chunks.add_argument("--document-id", required=True)
    doc_chunks.set_defaults(func=cmd_documents_chunks)

    # Sessions
    session_parser = subparsers.add_parser("sessions", help="Chat session utilities.")
    session_sub = session_parser.add_subparsers(dest="sessions_command", required=True)

    session_list = session_sub.add_parser("list", help="List chat sessions for a collection.")
    session_list.add_argument("--collection-id", required=True)
    session_list.set_defaults(func=cmd_sessions_list)

    session_history = session_sub.add_parser("history", help="Show full message history for a session.")
    session_history.add_argument("--session-id", required=True)
    session_history.set_defaults(func=cmd_sessions_history)

    # Models
    models_parser = subparsers.add_parser("models", help="Unified chat model catalog.")
    models_parser.add_argument("--refresh", action="store_true", help="Force refresh the cached catalog.")
    models_parser.add_argument("--limit", type=int, default=20, help="Limit printed rows (0 for all).")
    models_parser.set_defaults(func=cmd_models_list)

    # Health
    health_parser = subparsers.add_parser("health", help="Call the /api/health endpoint.")
    health_parser.set_defaults(func=cmd_health)

    return parser


def resolve_base_url(args, state: Dict[str, Any]) -> str:
    return (
        args.base_url
        or state.get("base_url")
        or ENV_BASE_URL
        or DEFAULT_BASE_URL
    )


def resolve_token(args, state: Dict[str, Any]) -> Optional[str]:
    return args.token or state.get("token") or ENV_TOKEN


def main(argv: Optional[List[str]] = None) -> None:
    parser = build_parser()
    args = parser.parse_args(argv)

    state = load_state(args.state_path)
    base_url = resolve_base_url(args, state)
    token = resolve_token(args, state)

    with BackendClient(base_url=base_url, token=token) as client:
        result = args.func(args, client, state, args.state_path)
        if args.json and result is not None:
            print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("Aborted by user.")
