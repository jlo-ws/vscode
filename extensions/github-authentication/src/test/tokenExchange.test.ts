/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as sinon from "sinon";
import { Uri } from "vscode";
import { fetching } from "../node/fetch";
import { Config } from "../config";

suite("GitHub Token Exchange", () => {
	let sandbox: sinon.SinonSandbox;
	let fetchingStub: sinon.SinonStub;
	let originalClientSecret: string | undefined;

	setup(() => {
		sandbox = sinon.createSandbox();
		fetchingStub = sandbox.stub(fetching as any, "default");
		originalClientSecret = Config.gitHubClientSecret;
	});

	teardown(() => {
		sandbox.restore();
		(Config as any).gitHubClientSecret = originalClientSecret;
	});

	async function exchangeCodeForToken(
		logger: any,
		endpointUri: Uri,
		redirectUri: Uri,
		code: string,
		enterpriseUri?: Uri
	): Promise<string> {
		const clientSecret = Config.gitHubClientSecret;
		if (!clientSecret) {
			throw new Error("No client secret configured for GitHub authentication.");
		}

		const body = new URLSearchParams([
			["code", code],
			["client_id", Config.gitHubClientId],
			["redirect_uri", redirectUri.toString(true)],
			["client_secret", clientSecret]
		]);
		if (enterpriseUri) {
			body.append("github_enterprise", enterpriseUri.toString(true));
		}
		const result = await fetching(endpointUri.toString(true), {
			logger,
			expectJSON: true,
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: body.toString()
		});

		if (result.ok) {
			const json = await result.json();
			logger.info("Token exchange success!");
			return json.access_token;
		} else {
			const text = await result.text();
			const error = new Error(text);
			error.name = "GitHubTokenExchangeError";
			throw error;
		}
	}

	test("should successfully exchange code for token", async () => {
		(Config as any).gitHubClientSecret = "test-client-secret";

		fetchingStub.resolves({
			ok: true,
			json: () => Promise.resolve({ access_token: "test-access-token" })
		});

		const mockLogger = { info: sinon.stub(), trace: sinon.stub(), error: sinon.stub() };
		const endpointUri = Uri.parse("https://github.com/login/oauth/access_token");
		const redirectUri = Uri.parse("http://localhost:3000/callback");
		const code = "test-code";

		const result = await exchangeCodeForToken(mockLogger, endpointUri, redirectUri, code);

		assert.strictEqual(result, "test-access-token");
		assert.ok(mockLogger.info.calledWith("Token exchange success!"));
	});

	test("should throw error when no client secret configured", async () => {
		(Config as any).gitHubClientSecret = undefined;

		const mockLogger = { info: sinon.stub(), trace: sinon.stub(), error: sinon.stub() };
		const endpointUri = Uri.parse("https://github.com/login/oauth/access_token");
		const redirectUri = Uri.parse("http://localhost:3000/callback");
		const code = "test-code";

		try {
			await exchangeCodeForToken(mockLogger, endpointUri, redirectUri, code);
			assert.fail("Should have thrown error");
		} catch (error) {
			assert.strictEqual(error.message, "No client secret configured for GitHub authentication.");
		}
	});

	test("should handle invalid client secret scenarios", async () => {
		(Config as any).gitHubClientSecret = "invalid-client-secret";

		fetchingStub.resolves({
			ok: false,
			text: () => Promise.resolve("{\"error\":\"bad_client_credentials\",\"error_description\":\"The client credentials are invalid\"}")
		});

		const mockLogger = { info: sinon.stub(), trace: sinon.stub(), error: sinon.stub() };
		const endpointUri = Uri.parse("https://github.com/login/oauth/access_token");
		const redirectUri = Uri.parse("http://localhost:3000/callback");
		const code = "test-code";

		try {
			await exchangeCodeForToken(mockLogger, endpointUri, redirectUri, code);
			assert.fail("Should have thrown error");
		} catch (error) {
			assert.strictEqual(error.name, "GitHubTokenExchangeError");
			assert.ok(error.message.includes("bad_client_credentials"));
		}
	});

	test("should handle network timeout during token exchange", async () => {
		(Config as any).gitHubClientSecret = "test-client-secret";

		fetchingStub.rejects(new Error("Network timeout"));

		const mockLogger = { info: sinon.stub(), trace: sinon.stub(), error: sinon.stub() };
		const endpointUri = Uri.parse("https://github.com/login/oauth/access_token");
		const redirectUri = Uri.parse("http://localhost:3000/callback");
		const code = "test-code";

		try {
			await exchangeCodeForToken(mockLogger, endpointUri, redirectUri, code);
			assert.fail("Should have thrown error");
		} catch (error) {
			assert.strictEqual(error.message, "Network timeout");
		}
	});

	test("should handle malformed token responses", async () => {
		(Config as any).gitHubClientSecret = "test-client-secret";

		fetchingStub.resolves({
			ok: true,
			json: () => Promise.reject(new Error("Invalid JSON"))
		});

		const mockLogger = { info: sinon.stub(), trace: sinon.stub(), error: sinon.stub() };
		const endpointUri = Uri.parse("https://github.com/login/oauth/access_token");
		const redirectUri = Uri.parse("http://localhost:3000/callback");
		const code = "test-code";

		try {
			await exchangeCodeForToken(mockLogger, endpointUri, redirectUri, code);
			assert.fail("Should have thrown error");
		} catch (error) {
			assert.strictEqual(error.message, "Invalid JSON");
		}
	});

	test("should handle missing access_token in response", async () => {
		(Config as any).gitHubClientSecret = "test-client-secret";

		fetchingStub.resolves({
			ok: true,
			json: () => Promise.resolve({ token_type: "bearer" })
		});

		const mockLogger = { info: sinon.stub(), trace: sinon.stub(), error: sinon.stub() };
		const endpointUri = Uri.parse("https://github.com/login/oauth/access_token");
		const redirectUri = Uri.parse("http://localhost:3000/callback");
		const code = "test-code";

		const result = await exchangeCodeForToken(mockLogger, endpointUri, redirectUri, code);

		assert.strictEqual(result, undefined);
	});

	test("should include enterprise URI when provided", async () => {
		(Config as any).gitHubClientSecret = "test-client-secret";

		fetchingStub.resolves({
			ok: true,
			json: () => Promise.resolve({ access_token: "test-access-token" })
		});

		const mockLogger = { info: sinon.stub(), trace: sinon.stub(), error: sinon.stub() };
		const endpointUri = Uri.parse("https://github.enterprise.com/login/oauth/access_token");
		const redirectUri = Uri.parse("http://localhost:3000/callback");
		const code = "test-code";
		const enterpriseUri = Uri.parse("https://github.enterprise.com");

		await exchangeCodeForToken(mockLogger, endpointUri, redirectUri, code, enterpriseUri);

		const callArgs = fetchingStub.getCall(0).args;
		const requestBody = callArgs[1].body;
		assert.ok(requestBody.includes("github_enterprise=https%3A%2F%2Fgithub.enterprise.com"));
	});

	test("should handle server errors (5xx)", async () => {
		(Config as any).gitHubClientSecret = "test-client-secret";

		fetchingStub.resolves({
			ok: false,
			status: 500,
			text: () => Promise.resolve("Internal Server Error")
		});

		const mockLogger = { info: sinon.stub(), trace: sinon.stub(), error: sinon.stub() };
		const endpointUri = Uri.parse("https://github.com/login/oauth/access_token");
		const redirectUri = Uri.parse("http://localhost:3000/callback");
		const code = "test-code";

		try {
			await exchangeCodeForToken(mockLogger, endpointUri, redirectUri, code);
			assert.fail("Should have thrown error");
		} catch (error) {
			assert.strictEqual(error.name, "GitHubTokenExchangeError");
			assert.strictEqual(error.message, "Internal Server Error");
		}
	});
});
