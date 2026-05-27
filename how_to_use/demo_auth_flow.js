// Node.js example showing Axiom Auth SDK usage
// Run with: node demo_auth_flow.js

import "dotenv/config";
import { AxiomAuth } from "../auth_sdks/javascript/index.js";

// Configuration from .env, falling back to defaults if not set
const PROJECT_URL = process.env.AXIOM_URL;
const keyName = process.env.AXIOM_KEY_NAME;
const keySecret = process.env.AXIOM_KEY_SECRET;
const API_KEY = Buffer.from(`${keyName}:${keySecret}`).toString("base64");

// Initialize SDK
const auth = new AxiomAuth({
    baseUrl: PROJECT_URL,
    apiKey: API_KEY,
    projectId: keyName,
});

async function runDemo() {
    console.log("=== Axiom Auth Demo ===");

    // 1. Anonymous Login
    console.log("\n[1] Logging in anonymously...");
    try {
        const anonRes = await auth.anonymousLogin();
        console.log("Success! Anonymous User ID:", anonRes.user.uid);
        console.log("Access Token:", anonRes.access_token);

        // 2. Fetch User Profile
        console.log("\n[2] Fetching profile via /me...");
        const meRes = await auth.getMe();
        console.log("Profile:", meRes.user);

        // 3. Upgrade Anonymous User
        const demoEmail = `test_${Date.now()}@example.com`;
        const demoPass = "super_secure_password_123!";
        console.log(`\n[3] Upgrading anonymous account to ${demoEmail}...`);

        const upgradeRes = await auth.upgradeAnonymous(
            demoEmail,
            demoPass,
            "Demo User",
            "https://ui-avatars.com/api/?name=Demo+User",
        );
        console.log("Upgrade successful! User is now permanent.");
        console.log("Email Verified?", upgradeRes.user.email_verified);

        // Note: If email verification is enabled, an email was just sent to demoEmail.
        // The user would click the link, and you would call auth.verifyEmail(token) or auth.verifyOtp(email, code).

        // 4. Update Profile Metadata
        console.log("\n[4] Updating custom metadata...");
        await auth.updateMe({
            metadata: {
                theme: "dark",
                role: "admin",
                onboarding_completed: true,
            },
        });
        const updatedMe = await auth.getMe();
        console.log("Updated Metadata:", updatedMe.user.metadata);

        // 5. Logout
        console.log("\n[5] Logging out...");
        await auth.logout();
        console.log("Logged out successfully.");

        // 6. Log back in
        console.log("\n[6] Logging back in...");
        const loginRes = await auth.login(demoEmail, demoPass);
        console.log(
            "Login successful! Welcome back,",
            loginRes.user.display_name,
        );

        // 7. List Active Sessions
        console.log("\n[7] Active Sessions:");
        const sessions = await auth.getSessions();
        console.table(sessions);

        // 8. Generate TOTP Secret (MFA)
        console.log("\n[8] Enrolling in MFA (TOTP)...");
        const totpRes = await auth.totpEnroll();
        console.log("Secret:", totpRes.secret);
        console.log("QR Code SVG length:", totpRes.qr_code_svg.length);
        console.log(
            "(User scans QR code with Google Authenticator, then calls auth.totpVerify(code))",
        );
    } catch (err) {
        console.error("\nError during demo:", err.message);
    }
}

runDemo();
