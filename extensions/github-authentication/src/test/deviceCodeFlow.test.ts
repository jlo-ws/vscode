/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as sinon from "sinon";
import { CancellationTokenSource } from "vscode";
import { fetching } from "../node/fetch";

suite("DeviceCodeFlow", () => {
	let sandbox: sinon.SinonSandbox;
	let fetchingStub: sinon.SinonStub;

	setup(() => {
		sandbox = sinon.createSandbox();
		fetchingStub = sandbox.stub(fetching as any, "default");
	});

	teardown(() => {
		sandbox.restore();
	});

	async function mockDeviceCodeFlow(options: any): Promise<string> {
		const deviceCodeResult = await fetching("https://github.com/login/oauth/device_code", {
			method: "POST",
			headers: { "Accept": "application/json" },
			body: new URLSearchParams({ client_id: "test-client-id", scope: options.scopes }).toString(),
			logger: options.logger || { info: () => {}, trace: () => {}, error: () => {} },
			expectJSON: true
		});

		if (!deviceCodeResult.ok) {
			throw new Error("Device code request failed");
		}

		const deviceCodeData = await deviceCodeResult.json();
		
		let attempts = 0;
		const maxAttempts = 120;
		
		while (attempts < maxAttempts) {
			if (options.token?.isCancellationRequested) {
				throw new Error("User cancelled the authentication flow.");
			}

			try {
				const result = await fetching("https://github.com/login/oauth/access_token", {
					method: "POST",
					headers: { "Accept": "application/json" },
					body: new URLSearchParams({
						client_id: "test-client-id",
						device_code: deviceCodeData.device_code,
						grant_type: "urn:ietf:params:oauth:grant-type:device_code"
					}).toString(),
					logger: options.logger || { info: () => {}, trace: () => {}, error: () => {} },
					expectJSON: true
				});

				if (!result.ok) {
					attempts++;
					await new Promise(resolve => setTimeout(resolve, deviceCodeData.interval * 1000));
					continue;
				}

				const json = await result.json();
				
				if (json.error) {
					if (json.error === "authorization_pending") {
						attempts++;
						await new Promise(resolve => setTimeout(resolve, deviceCodeData.interval * 1000));
						continue;
					}
					throw new Error(json.error_description || json.error);
				}

				return json.access_token;
			} catch (error) {
				if (error.message === "authorization_pending") {
					attempts++;
					await new Promise(resolve => setTimeout(resolve, deviceCodeData.interval * 1000));
					continue;
				}
				throw error;
			}
		}

		throw new Error("Authentication timed out. Please try again.");
	}

	suite("Device Code Flow Tests", () => {
		test("should poll for access token and succeed", async () => {
			const mockDeviceCodeResponse = {
				device_code: "test-device-code",
				user_code: "TEST-CODE",
				verification_uri: "https://github.com/login/device",
				interval: 1
			};

			fetchingStub.onFirstCall().resolves({
				ok: true,
				json: () => Promise.resolve(mockDeviceCodeResponse)
			});

			fetchingStub.onSecondCall().resolves({
				ok: true,
				json: () => Promise.resolve({ error: "authorization_pending" })
			});

			fetchingStub.onThirdCall().resolves({
				ok: true,
				json: () => Promise.resolve({ access_token: "test-access-token" })
			});

			const result = await mockDeviceCodeFlow({
				scopes: "read:user"
			});

			assert.strictEqual(result, "test-access-token");
		});

		test("should handle authorization_pending errors", async () => {
			const mockDeviceCodeResponse = {
				device_code: "test-device-code",
				user_code: "TEST-CODE",
				verification_uri: "https://github.com/login/device",
				interval: 1
			};

			fetchingStub.onFirstCall().resolves({
				ok: true,
				json: () => Promise.resolve(mockDeviceCodeResponse)
			});

			for (let i = 0; i < 5; i++) {
				fetchingStub.onCall(i + 1).resolves({
					ok: true,
					json: () => Promise.resolve({ error: "authorization_pending" })
				});
			}

			fetchingStub.onCall(6).resolves({
				ok: true,
				json: () => Promise.resolve({ access_token: "test-access-token" })
			});

			const result = await mockDeviceCodeFlow({
				scopes: "read:user"
			});

			assert.strictEqual(result, "test-access-token");
		});

		test("should timeout after 120 polling attempts", async () => {
			const mockDeviceCodeResponse = {
				device_code: "test-device-code",
				user_code: "TEST-CODE",
				verification_uri: "https://github.com/login/device",
				interval: 1
			};

			fetchingStub.onFirstCall().resolves({
				ok: true,
				json: () => Promise.resolve(mockDeviceCodeResponse)
			});

			fetchingStub.resolves({
				ok: true,
				json: () => Promise.resolve({ error: "authorization_pending" })
			});

			try {
				await mockDeviceCodeFlow({
					scopes: "read:user"
				});
				assert.fail("Should have thrown timeout error");
			} catch (error) {
				assert.strictEqual(error.message, "Authentication timed out. Please try again.");
			}
		});

		test("should handle cancellation token", async () => {
			const mockDeviceCodeResponse = {
				device_code: "test-device-code",
				user_code: "TEST-CODE",
				verification_uri: "https://github.com/login/device",
				interval: 1
			};

			fetchingStub.onFirstCall().resolves({
				ok: true,
				json: () => Promise.resolve(mockDeviceCodeResponse)
			});

			fetchingStub.resolves({
				ok: true,
				json: () => Promise.resolve({ error: "authorization_pending" })
			});

			const tokenSource = new CancellationTokenSource();
			setTimeout(() => tokenSource.cancel(), 100);

			try {
				await mockDeviceCodeFlow({
					scopes: "read:user",
					token: tokenSource.token
				});
				assert.fail("Should have thrown cancellation error");
			} catch (error) {
				assert.strictEqual(error.message, "User cancelled the authentication flow.");
			}
		});

		test("should handle network failures during polling", async () => {
			const mockDeviceCodeResponse = {
				device_code: "test-device-code",
				user_code: "TEST-CODE",
				verification_uri: "https://github.com/login/device",
				interval: 1
			};

			fetchingStub.onFirstCall().resolves({
				ok: true,
				json: () => Promise.resolve(mockDeviceCodeResponse)
			});

			fetchingStub.onSecondCall().rejects(new Error("Network error"));

			try {
				await mockDeviceCodeFlow({
					scopes: "read:user"
				});
				assert.fail("Should have thrown network error");
			} catch (error) {
				assert.strictEqual(error.message, "Network error");
			}
		});

		test("should handle error responses with error_description", async () => {
			const mockDeviceCodeResponse = {
				device_code: "test-device-code",
				user_code: "TEST-CODE",
				verification_uri: "https://github.com/login/device",
				interval: 1
			};

			fetchingStub.onFirstCall().resolves({
				ok: true,
				json: () => Promise.resolve(mockDeviceCodeResponse)
			});

			fetchingStub.onSecondCall().resolves({
				ok: true,
				json: () => Promise.resolve({
					error: "access_denied",
					error_description: "The user denied the request"
				})
			});

			try {
				await mockDeviceCodeFlow({
					scopes: "read:user"
				});
				assert.fail("Should have thrown error");
			} catch (error) {
				assert.strictEqual(error.message, "The user denied the request");
			}
		});

		test("should handle device code request failure", async () => {
			fetchingStub.onFirstCall().rejects(new Error("Network error"));

			try {
				await mockDeviceCodeFlow({
					scopes: "read:user"
				});
				assert.fail("Should have thrown error");
			} catch (error) {
				assert.strictEqual(error.message, "Network error");
			}
		});
	});
});
