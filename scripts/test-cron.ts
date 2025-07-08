/**
 * Test script to simulate the cron job locally
 */
async function testCron() {
	console.log("🧪 Testing cron job functionality...");

	// Test environment variables
	const walletKey = process.env.WALLET_KEY;
	const encryptionKey = process.env.ENCRYPTION_KEY;
	const bitteApiKey = process.env.BITTE_API_KEY;

	console.log("Environment check:");
	console.log("- WALLET_KEY:", walletKey ? "✅ Set" : "❌ Missing");
	console.log("- ENCRYPTION_KEY:", encryptionKey ? "✅ Set" : "❌ Missing");
	console.log("- BITTE_API_KEY:", bitteApiKey ? "✅ Set" : "❌ Missing");

	if (!walletKey || !encryptionKey || !bitteApiKey) {
		console.error("❌ Missing required environment variables");
		process.exit(1);
	}

	try {
		// Test the cron endpoint
		const baseUrl = process.env.VERCEL_URL
			? `https://${process.env.VERCEL_URL}`
			: "http://localhost:3000";
		const cronUrl = `${baseUrl}/api`;

		console.log(`\n📞 Testing cron endpoint: ${cronUrl}`);

		const response = await fetch(cronUrl, {
			method: "GET",
			headers: {
				"User-Agent": "Vercel-Cron/1.0",
			},
		});

		const result = await response.json();

		console.log("📊 Cron response:", {
			status: response.status,
			statusText: response.statusText,
			result,
		});

		if (response.ok) {
			console.log("✅ Cron job test successful!");
		} else {
			console.log("❌ Cron job test failed!");
		}
	} catch (error) {
		console.error("❌ Test failed:", error);
		process.exit(1);
	}
}

// Run the test
testCron().catch(console.error);
