"""Simple API key encryption at rest using Fernet.

Encrypts API keys before writing to settings.json so they are not stored
in plain text. Uses a machine-derived key (hostname + app name) so the
encrypted value is tied to the current machine.

This is obfuscation, not industrial security — a determined user with
access to the source code could derive the key. But it prevents casual
exposure of API keys in config files.
"""

import base64
import hashlib
import socket

from cryptography.fernet import Fernet, InvalidToken


def _derive_key() -> bytes:
    """Derive a Fernet key from machine-specific info."""
    material = f"TSH-{socket.gethostname()}-ProjectRioStreamHelper".encode()
    digest = hashlib.sha256(material).digest()
    return base64.urlsafe_b64encode(digest)


_fernet = Fernet(_derive_key())


def encrypt_key(plaintext: str) -> str:
    """Encrypt an API key for storage. Returns a 'enc:' prefixed string."""
    if not plaintext:
        return ""
    token = _fernet.encrypt(plaintext.encode())
    return f"enc:{token.decode()}"


def decrypt_key(stored: str) -> str:
    """Decrypt an API key from storage. Handles both encrypted and plain text."""
    if not stored:
        return ""
    if stored.startswith("enc:"):
        try:
            return _fernet.decrypt(stored[4:].encode()).decode()
        except InvalidToken:
            # Key was encrypted on a different machine or corrupted
            return ""
    # Plain text (legacy / not yet encrypted) — return as-is
    return stored
