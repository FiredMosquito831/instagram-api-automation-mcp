"""The instagrapi sidecar: one instagrapi client behind a JSON-lines protocol on stdin and stdout.

Request, one JSON line:   {"id": <any>, "method": <name>, "params": {...}}
Response, one JSON line:  {"id": <same>, "ok": true, "result": <value>}
                          {"id": <same>, "ok": false, "error": {"kind": <kind>, "message": <text>}}

The Node side maps challenge, checkpoint and two_factor to CHECKPOINT, auth_expired to AUTH_EXPIRED,
rate_limited to RATE_LIMITED and action_blocked to ACTION_BLOCKED. Every other kind, including api_error,
bad_request and no_session, becomes UNOFFICIAL_ADAPTER_ERROR.

Rules kept here:
- Logs go to stderr only. A password, a verification code or a session value never reaches a log, a response
  message or a print. This module has no print call.
- instagrapi is imported inside functions, so map_exception_kind works without instagrapi installed.
- The challenge resolvers are never imported. The client is built with with_challenge_flow=False, and both
  challenge handlers are replaced by one that refuses, so a challenge fails the call. Nothing reads stdin.
- stdout carries only protocol lines. The protocol stream is taken first, then sys.stdout is pointed at stderr,
  so a stray print from the library cannot corrupt a response line.
"""

import json
import logging
import sys
from urllib.parse import quote

log = logging.getLogger("ig_sidecar")

# Exception class names that map to a kind, beyond the "Challenge" rule. Each one is an instagrapi class for a
# stop condition in the global constraints. The names were read from instagrapi 3.1.0 exceptions.py.
_EXACT_KINDS = {
    "TwoFactorRequired": "two_factor",
    "LoginRequired": "auth_expired",
    "ClientLoginRequired": "auth_expired",  # Instagram redirected the request to the login page
    "ClientThrottledError": "rate_limited",  # HTTP 429
    "RateLimitError": "rate_limited",  # error_type rate_limit_error
    "PleaseWaitFewMinutes": "rate_limited",  # "Please wait a few minutes"
    "FeedbackRequired": "action_blocked",
    "SentryBlock": "action_blocked",
    "AccountSuspended": "challenge",  # raised from a challenge_required response with a /suspended/ URL
    "ProxyAddressIsBlocked": "action_blocked",  # the address the call leaves from is blocked; the action is refused, as a stop
}

PROFILE_FIELDS = frozenset({"biography", "external_url", "full_name"})
SECRET_PARAMS = ("password", "verificationCode")

_STATE = {"client": None}


class SidecarError(Exception):
    """A refusal this module raises itself. Its kind goes to the caller unchanged."""

    def __init__(self, kind, message):
        super().__init__(message)
        self.kind = kind


def map_exception_kind(name):
    """Map an exception class name to a sidecar kind. Pure: it imports nothing and needs no instagrapi."""
    text = str(name)
    if "Challenge" in text:
        return "challenge"
    return _EXACT_KINDS.get(text, "api_error")


# Most severe first, as STOP_RANK in src/guard.js (rank 3, then rate_limited at rank 2); this order decides within rank 3.
_SEVERITY = ("challenge", "checkpoint", "two_factor", "auth_expired", "action_blocked", "rate_limited")
_SEVERITY_RANK = {kind: index for index, kind in enumerate(_SEVERITY)}


def _kind_for_class(cls):
    """Map a class by its own name, then by each base. A subclass of a stop exception keeps the stop."""
    for base in cls.__mro__:
        kind = map_exception_kind(base.__name__)
        if kind != "api_error":
            return kind
    return "api_error"


def kind_for_exception(exc):
    """Map an exception, and every exception it was raised from, to the most severe stop kind found.

    The walk visits the exception, then its __cause__ and its __context__, and so on. Each exception is visited once,
    so a cycle ends the walk and a chain of any depth is followed. A stop kind beats api_error. Among stop kinds, the
    most severe wins (see _SEVERITY).
    """
    best = "api_error"
    queue = [exc]
    seen = set()
    while queue:
        current = queue.pop(0)
        if current is None or id(current) in seen:
            continue
        seen.add(id(current))
        kind = _kind_for_class(type(current))
        if kind != "api_error" and (best == "api_error" or _SEVERITY_RANK[kind] < _SEVERITY_RANK[best]):
            best = kind
        queue.extend((current.__cause__, current.__context__))
    return best


INSTAGRAPI_MISSING = "instagrapi is not installed; install the pinned version in sidecar/requirements.txt"


def _new_client():
    # Imported here, so the module loads and map_exception_kind works without instagrapi. A missing library is "unavailable": the
    # session did not start, so the Node side does not treat it as an expired login.
    try:
        from instagrapi import Client
        from instagrapi.exceptions import ChallengeRequired
    except ImportError:
        raise SidecarError("unavailable", INSTAGRAPI_MISSING)

    def refuse_challenge(*args, **kwargs):
        # instagrapi's own defaults read a code or a password from stdin, which is the protocol stream, and
        # one path reaches them even with with_challenge_flow=False (the CAA two-step code entry). This refusal
        # replaces them: the call fails with a challenge error, which the Node side records as a stop.
        raise ChallengeRequired("a challenge needs the owner; the sidecar does not answer challenges")

    # with_challenge_flow=False: a challenge is raised to the caller and never resolved automatically.
    client = Client(with_challenge_flow=False)
    client.challenge_code_handler = refuse_challenge
    client.change_password_handler = refuse_challenge
    return client


def _loaded_client():
    client = _STATE["client"]
    if client is None:
        raise SidecarError("no_session", "no session is loaded; call restore_session or login first")
    return client


def _text(params, name):
    value = params.get(name)
    if not isinstance(value, str) or value == "":
        raise SidecarError("bad_request", f"{name} must be a non-empty string")
    return value


def _optional_text(params, name):
    value = params.get(name)
    if value is None:
        return ""
    if not isinstance(value, str):
        raise SidecarError("bad_request", f"{name} must be a string")
    return value


def _user_id(params):
    value = params.get("userId")
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise SidecarError("bad_request", "userId must be a numeric string")
    text = str(value)
    if not (text.isascii() and text.isdigit()):
        raise SidecarError("bad_request", "userId must be a numeric string")
    return text


def login(params):
    username = _text(params, "username")
    password = _text(params, "password")
    code = _optional_text(params, "verificationCode")
    client = _new_client()
    if not client.login(username, password, verification_code=code):
        raise SidecarError("api_error", "login did not complete")
    _STATE["client"] = client
    return client.get_settings()


def restore_session(params):
    session = params.get("session")
    if not isinstance(session, dict) or not session:
        raise SidecarError("bad_request", "session must be a non-empty object")
    client = _new_client()
    client.set_settings(session)
    client.account_info()  # one read: LoginRequired here means the stored session has expired
    _STATE["client"] = client
    return client.get_settings()


def follow(params):
    user_id = _user_id(params)
    return {"ok": bool(_loaded_client().user_follow(user_id))}


def unfollow(params):
    user_id = _user_id(params)
    return {"ok": bool(_loaded_client().user_unfollow(user_id))}


def profile_edit(params):
    fields = params.get("fields")
    if not isinstance(fields, dict) or not fields:
        raise SidecarError("bad_request", "fields must be a non-empty object")
    unknown = sorted(set(fields) - PROFILE_FIELDS)
    if unknown:
        raise SidecarError("bad_request", "profile field not allowed: " + ", ".join(unknown))
    if not all(isinstance(value, str) for value in fields.values()):
        raise SidecarError("bad_request", "profile field values must be strings")
    _loaded_client().account_edit(**fields)
    return {"edited": sorted(fields)}


def status(params):
    # Local state only: user_id is read from the stored cookies, so no request is made.
    client = _STATE["client"]
    return {"loggedIn": client is not None and client.user_id is not None}


HANDLERS = {
    "login": login,
    "restore_session": restore_session,
    "follow": follow,
    "unfollow": unfollow,
    "profile_edit": profile_edit,
    "status": status,
}


def _error(request_id, kind, message):
    return {"id": request_id, "ok": False, "error": {"kind": kind, "message": message}}


def _strings(value):
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for item in value.values():
            yield from _strings(item)
    elif isinstance(value, list):
        for item in value:
            yield from _strings(item)


def _secret_forms(value):
    """The forms in which one secret may appear in text. They are the forms the JS registry masks (review M-6): the raw value,
    its URL-encoded form (the same as encodeURIComponent) and its JSON-escaped form without the quotes (the same as JSON.stringify).
    The longest form comes first, so a longer form is replaced before any shorter form that it contains."""
    forms = {value}
    try:
        forms.add(quote(value, safe="!*'()~"))  # URL-encoded, as encodeURIComponent writes it
    except UnicodeEncodeError:
        pass  # a lone surrogate cannot be encoded, so it has no URL-encoded form
    forms.add(json.dumps(value, ensure_ascii=False)[1:-1])  # JSON-escaped, as JSON.stringify writes it, without the quotes
    return sorted((form for form in forms if form), key=len, reverse=True)


def _safe_message(exc, params):
    """The exception text with every secret the request carried removed, in its raw, JSON-escaped and URL-encoded forms,
    capped at 500 characters."""
    text = str(exc) or type(exc).__name__
    secrets = [params.get(name) for name in SECRET_PARAMS]
    secrets.extend(_strings(params.get("session")))
    for secret in secrets:
        if isinstance(secret, str) and secret:
            for form in _secret_forms(secret):
                text = text.replace(form, "[redacted]")
    return text[:500]


def handle_request(request):
    if not isinstance(request, dict):
        return _error(None, "bad_request", "a request must be a JSON object")
    request_id = request.get("id")
    method = request.get("method")
    params = request.get("params", {})
    if params is None:
        params = {}
    if not isinstance(params, dict):
        return _error(request_id, "bad_request", "params must be a JSON object")
    handler = HANDLERS.get(method) if isinstance(method, str) else None
    if handler is None:
        return _error(request_id, "bad_request", "unknown method")
    try:
        result = handler(params)
    except SidecarError as exc:
        log.warning("%s refused (%s)", method, exc.kind)
        return _error(request_id, exc.kind, str(exc))
    except Exception as exc:  # a library error: report its kind, never the arguments
        kind = kind_for_exception(exc)
        log.warning("%s failed with %s (%s)", method, type(exc).__name__, kind)
        return _error(request_id, kind, _safe_message(exc, params))
    log.info("%s ok", method)
    return {"id": request_id, "ok": True, "result": result}


def serve(lines, out):
    """Answers each request line with one response line. lines yields bytes and out takes bytes."""
    for raw in lines:
        if not raw.strip():
            continue
        try:
            request = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            response = _error(None, "bad_request", "the request line is not valid JSON")
        else:
            response = handle_request(request)
        try:
            line = json.dumps(response)
        except (TypeError, ValueError):
            line = json.dumps(_error(response.get("id"), "api_error", "the result could not be encoded"))
        out.write((line + "\n").encode("utf-8"))
        out.flush()


def main():
    logging.basicConfig(stream=sys.stderr, level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    protocol_out = sys.stdout.buffer
    sys.stdout = sys.stderr  # a print from the library goes to stderr, never into a response line
    try:
        serve(sys.stdin.buffer, protocol_out)
    except BrokenPipeError:
        pass  # the caller closed the pipe


if __name__ == "__main__":
    main()
