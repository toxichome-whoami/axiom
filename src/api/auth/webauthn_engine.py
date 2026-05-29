import json
from typing import Any, Dict, List

from webauthn import (generate_authentication_options,
                      generate_registration_options, options_to_json,
                      verify_authentication_response,
                      verify_registration_response)
from webauthn.helpers.structs import (AuthenticatorSelectionCriteria,
                                      PublicKeyCredentialDescriptor,
                                      UserVerificationRequirement)


class WebAuthnEngine:
    @staticmethod
    def get_registration_options(
        rp_id: str,
        rp_name: str,
        user_id: str,
        user_name: str,
        existing_credentials: List[str],
    ) -> Dict[str, Any]:

        exclude_credentials = [
            PublicKeyCredentialDescriptor(id=cred_id.encode("utf-8"))
            for cred_id in existing_credentials
        ]

        options = generate_registration_options(
            rp_id=rp_id,
            rp_name=rp_name,
            user_id=user_id.encode("utf-8"),
            user_name=user_name,
            exclude_credentials=exclude_credentials,
            authenticator_selection=AuthenticatorSelectionCriteria(
                user_verification=UserVerificationRequirement.PREFERRED
            ),
        )
        return json.loads(options_to_json(options))

    @staticmethod
    def verify_registration(
        credential_json: str, challenge: str, rp_id: str, origin: str
    ) -> Any:
        verification = verify_registration_response(
            credential=credential_json,
            expected_challenge=challenge.encode("utf-8"),
            expected_origin=origin,
            expected_rp_id=rp_id,
            require_user_verification=False,
        )
        return verification

    @staticmethod
    def get_authentication_options(
        rp_id: str, existing_credentials: List[str]
    ) -> Dict[str, Any]:
        allow_credentials = [
            PublicKeyCredentialDescriptor(id=cred_id.encode("utf-8"))
            for cred_id in existing_credentials
        ]
        options = generate_authentication_options(
            rp_id=rp_id,
            allow_credentials=allow_credentials,
            user_verification=UserVerificationRequirement.PREFERRED,
        )
        return json.loads(options_to_json(options))

    @staticmethod
    def verify_authentication(
        credential_json: str,
        challenge: str,
        rp_id: str,
        origin: str,
        public_key: bytes,
        sign_count: int,
    ) -> Any:
        verification = verify_authentication_response(
            credential=credential_json,
            expected_challenge=challenge.encode("utf-8"),
            expected_origin=origin,
            expected_rp_id=rp_id,
            credential_public_key=public_key,
            credential_current_sign_count=sign_count,
            require_user_verification=False,
        )
        return verification
