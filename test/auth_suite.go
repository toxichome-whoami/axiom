package main

import (
	"fmt"
	"time"
)

func RunAuthTests() (map[string]string, string) {
	testEmail := fmt.Sprintf("tester_%d@example.com", time.Now().Unix())

	testEndpoint("Auth JWKS", "GET", "/api/v1/auth/.well-known/jwks.json", nil, map[string]string{})
	testEndpoint("Auth Signup", "POST", "/api/v1/auth/signup", map[string]string{"email": testEmail, "password": "password123"}, nil)
	loginResp := testEndpoint("Auth Login", "POST", "/api/v1/auth/login", map[string]string{"email": testEmail, "password": "password123"}, nil)

	bearer := make(map[string]string)
	if loginResp != nil {
		if success, ok := loginResp["success"].(bool); ok && success {
			if token, ok := loginResp["access_token"].(string); ok {
				bearer["X-User-Access-Token"] = token
			}
		}
	}

	testEndpoint("Auth Magic Link", "POST", "/api/v1/auth/magic-link", map[string]string{"email": testEmail}, nil)

	testEndpoint("Auth Anonymous", "POST", "/api/v1/auth/anonymous", nil, nil)
	testEndpoint("Auth User Sessions", "GET", "/api/v1/auth/user/sessions", nil, bearer)
	testEndpoint("Auth TOTP Enroll", "POST", "/api/v1/auth/totp/enroll", nil, bearer)
	testEndpoint("Auth Change Email", "POST", "/api/v1/auth/user/email", map[string]string{"new_email": "new@example.com", "password": "password123"}, bearer)
	testEndpoint("Auth Change Password", "POST", "/api/v1/auth/user/password", map[string]string{"new_password": "newpassword123", "current_password": "password123"}, bearer)
	testEndpoint("Auth Forgot Password", "POST", "/api/v1/auth/password/forgot", map[string]string{"email": testEmail}, nil)

	var refreshToken string
	if loginResp != nil {
		if success, ok := loginResp["success"].(bool); ok && success {
			if rToken, ok := loginResp["refresh_token"].(string); ok {
				refreshToken = rToken
			}
		}
	}

	testEndpoint("Auth Refresh", "POST", "/api/v1/auth/refresh", map[string]string{"refresh_token": refreshToken}, bearer)

	testEndpoint("Auth Anonymous Upgrade", "POST", "/api/v1/auth/anonymous/upgrade", map[string]string{"email": "anon2@example.com", "password": "password123"}, bearer)
	testEndpoint("Auth TOTP Confirm", "POST", "/api/v1/auth/totp/confirm", map[string]string{"code": "123456"}, bearer)
	testEndpoint("Auth TOTP Verify", "POST", "/api/v1/auth/totp/verify", map[string]string{"code": "123456"}, bearer)
	testEndpoint("Auth TOTP Disable", "POST", "/api/v1/auth/totp/disable", map[string]string{"code": "123456"}, bearer)
	testEndpoint("Auth TOTP Backup Verify", "POST", "/api/v1/auth/totp/backup/verify", map[string]string{"code": "ABC-DEF-123"}, bearer)
	testEndpoint("Auth Revoke All Sessions", "DELETE", "/api/v1/auth/user/sessions", nil, bearer)
	testEndpoint("Auth Verify Email", "POST", "/api/v1/auth/verify/email", map[string]string{"token": "dummy"}, nil)
	testEndpoint("Auth Password Reset", "POST", "/api/v1/auth/password/reset", map[string]string{"token": "dummy", "new_password": "newpassword123"}, nil)
	testEndpoint("Auth Magic Link Verify", "POST", "/api/v1/auth/magic-link/verify", map[string]string{"token": "dummy"}, nil)
	testEndpoint("Auth OTP Send", "POST", "/api/v1/auth/otp/send", map[string]string{"email": testEmail}, nil)
	testEndpoint("Auth Verify OTP", "POST", "/api/v1/auth/verify/otp", map[string]string{"email": testEmail, "code": "123456"}, nil)
	testEndpoint("Auth Resend", "POST", "/api/v1/auth/resend", map[string]string{"email": testEmail}, nil)
	testEndpoint("Auth Change Email Confirm", "POST", "/api/v1/auth/user/email/confirm", map[string]string{"token": "dummy"}, bearer)

	return bearer, refreshToken
}

func RunAuthLogoutTest(bearer map[string]string, refreshToken string) {
	testEndpoint("Auth Logout", "POST", "/api/v1/auth/logout", map[string]string{"refresh_token": refreshToken}, bearer)
}

func RunAdminTests() {
	testEndpoint("Admin List Users", "GET", "/api/v1/auth/admin/users", nil, map[string]string{"X-Axiom-Key": AdminToken})
	testEndpoint("Admin Audit Logs", "GET", "/api/v1/auth/admin/audit", nil, map[string]string{"X-Axiom-Key": AdminToken})
	testEndpoint("Admin Templates", "GET", "/api/v1/auth/admin/templates", nil, map[string]string{"X-Axiom-Key": AdminToken})
	testEndpoint("Admin Users Export", "GET", "/api/v1/auth/admin/users/export", nil, map[string]string{"X-Axiom-Key": AdminToken})
	testEndpoint("Admin Users Import", "POST", "/api/v1/auth/admin/users/import", map[string]string{"data": "dummy"}, map[string]string{"X-Axiom-Key": AdminToken})
}
