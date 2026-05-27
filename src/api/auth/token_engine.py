import base64
import os
import secrets
import time
import uuid
from typing import Any, Dict, Optional

import jwt
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ed25519

from src.api.errors import AxiomException, ErrorCodes


class TokenEngine:
    """Ed25519 JWT and Refresh Token generator/validator."""

    def __init__(self, keys_dir: str = "./data/auth/.keys"):
        self.keys_dir = keys_dir
        self.private_key = None
        self.public_key = None
        self.key_id = "axiom-auth-1"

    def init_keys(self) -> None:
        """Loads or generates the Ed25519 key pair."""
        os.makedirs(self.keys_dir, exist_ok=True)
        key_path = os.path.join(self.keys_dir, "ed25519.pem")

        if os.path.exists(key_path):
            with open(key_path, "rb") as f:
                key_data = f.read()
                key = serialization.load_pem_private_key(
                    key_data, password=None, backend=default_backend()
                )
            if not isinstance(key, ed25519.Ed25519PrivateKey):
                raise ValueError("Invalid key type loaded")
            self.private_key = key
        else:
            self.private_key = ed25519.Ed25519PrivateKey.generate()
            pem = self.private_key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
            with open(key_path, "wb") as f:
                f.write(pem)

        self.public_key = self.private_key.public_key()

    def create_access_token(
        self,
        project_id: str,
        uid: str,
        email: str,
        email_verified: bool,
        is_anonymous: bool,
        totp_verified: bool,
        ttl: int,
        custom_claims: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Generates an Ed25519 signed JWT."""
        if not self.private_key:
            self.init_keys()
        assert self.private_key is not None

        now = int(time.time())
        payload = {
            "sub": uid,
            "email": email,
            "email_verified": email_verified,
            "is_anonymous": is_anonymous,
            "totp_verified": totp_verified,
            "iat": now,
            "exp": now + ttl,
            "iss": "axiom",
            "aud": project_id,
            "jti": str(uuid.uuid4()),
        }

        if custom_claims:
            for k, v in custom_claims.items():
                if k not in payload:
                    payload[k] = v

        return jwt.encode(
            payload,
            self.private_key,
            algorithm="EdDSA",
            headers={"kid": self.key_id},
        )

    def verify_access_token(self, token: str, project_id: str) -> Dict[str, Any]:
        """Verifies JWT signature, expiry, and audience (project isolation)."""
        if not self.public_key:
            self.init_keys()
        assert self.public_key is not None

        try:
            decoded = jwt.decode(
                token,
                self.public_key,
                algorithms=["EdDSA"],
                audience=project_id,
                issuer="axiom",
            )
            return decoded
        except jwt.ExpiredSignatureError:
            raise AxiomException(
                code=ErrorCodes.AUTH_TOKEN_EXPIRED,
                message="Access token expired",
                status_code=401,
            )
        except jwt.InvalidAudienceError:
            raise AxiomException(
                code=ErrorCodes.AUTH_TOKEN_INVALID,
                message="Invalid audience for this project",
                status_code=401,
            )
        except jwt.PyJWTError as e:
            raise AxiomException(
                code=ErrorCodes.AUTH_TOKEN_INVALID,
                message=f"Invalid token: {str(e)}",
                status_code=401,
            )

    def get_jwks(self) -> Dict[str, Any]:
        """Returns the public key in JWKS format for third-party verification."""
        if not self.public_key:
            self.init_keys()
        assert self.public_key is not None

        # Extract raw public bytes
        pub_bytes = self.public_key.public_bytes(
            encoding=serialization.Encoding.Raw,
            format=serialization.PublicFormat.Raw,
        )

        # Base64url encode without padding
        x = base64.urlsafe_b64encode(pub_bytes).rstrip(b"=").decode("ascii")

        return {
            "keys": [
                {
                    "kty": "OKP",
                    "crv": "Ed25519",
                    "x": x,
                    "kid": self.key_id,
                    "use": "sig",
                }
            ]
        }

    @staticmethod
    def generate_refresh_token() -> str:
        """Returns a 64-byte random hex string."""
        return secrets.token_hex(64)


# Global singleton
token_engine = TokenEngine()
