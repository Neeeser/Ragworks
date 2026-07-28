"""Reusable chat wire-format implementations, one module per dialect.

A *dialect* is a wire protocol, not a vendor: `ChatCompletionsProvider` is what
OpenAI, OpenRouter, vLLM, llama.cpp, and LM Studio all speak, so adding any of
them costs a descriptor and a client, not a parser. `ResponsesProvider` and
`MessagesProvider` are the two formats that genuinely differ. Vendor
extensions ride the hook the dialect exposes (`build_extra_body`), never a
fork of the parser — two copies of a stream parser drift, and the drift shows
up as a tool call that silently never runs.
"""

from app.providers.chat.dialects.chat_completions import (
    CHAT_COMPLETIONS_PARAMETERS,
    ChatCompletionsProvider,
)
from app.providers.chat.dialects.messages import (
    BASE_PARAMETERS as MESSAGES_PARAMETERS,
)
from app.providers.chat.dialects.messages import MessagesProvider
from app.providers.chat.dialects.responses import (
    RESPONSES_PARAMETERS,
    ResponsesProvider,
)

__all__ = [
    "CHAT_COMPLETIONS_PARAMETERS",
    "MESSAGES_PARAMETERS",
    "RESPONSES_PARAMETERS",
    "ChatCompletionsProvider",
    "MessagesProvider",
    "ResponsesProvider",
]
