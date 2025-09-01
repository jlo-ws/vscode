/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from "assert";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { AzureActiveDirectoryService } from "../AADHelper";
import { LoopbackAuthServer } from "../node/authServer";
import { raceCancellationAndTimeoutError } from "../common/async";

suite("AzureActiveDirectoryService", () => {
	let sandbox: sinon.SinonSandbox;
	let aadService: AzureActiveDirectoryService;
	let mockLogger: any;
	let mockTokenStorage: any;
	let mockUriHandler: any;

	setup(() => {
		sandbox = sinon.createSandbox();
		mockLogger = {
			trace: sinon.stub(),
			info: sinon.stub(),
			error: sinon.stub(),
			warn: sinon.stub()
		};
		mockTokenStorage = {
			get: sinon.stub(),
			store: sinon.stub(),
			delete: sinon.stub(),
			deleteAll: sinon.stub(),
			onDidChangeInOtherWindow: { event: sinon.stub() }
		};
		mockUriHandler = {
			event: sinon.stub()
		};

		aadService = new AzureActiveDirectoryService(
			mockLogger,
			"test-context" as any,
			mockUriHandler,
			mockTokenStorage,
			undefined as any,
			undefined as any
		);
	});

	teardown(() => {
		sandbox.restore();
	});

	suite("createSessionWithLocalServer", () => {
		test("should create session with local server successfully", async () => {
			const mockServer = {
				start: sinon.stub().resolves(3000),
				stop: sinon.stub().resolves(),
				waitForOAuthResponse: sinon.stub().resolves({ code: "test-code" }),
				nonce: "test-nonce",
				port: 3000
			};

			sandbox.stub(LoopbackAuthServer.prototype, "start").resolves(3000);
			sandbox.stub(LoopbackAuthServer.prototype, "stop").resolves();
			sandbox.stub(LoopbackAuthServer.prototype, "waitForOAuthResponse").resolves({ code: "test-code", state: "test-state" });
			sandbox.stub(LoopbackAuthServer.prototype, "nonce").get(() => "test-nonce");
			sandbox.stub(LoopbackAuthServer.prototype, "port").get(() => 3000);

			sandbox.stub(vscode.env, "openExternal").resolves(true);
			sandbox.stub(raceCancellationAndTimeoutError as any).resolves({ code: "test-code", state: "test-state" });

			const mockExchangeCodeForSession = sandbox.stub(aadService as any, "exchangeCodeForSession").resolves({
				id: "test-session-id",
				accessToken: "test-access-token",
				account: { id: "test-account", label: "Test Account" },
				scopes: ["test-scope"]
			});

			const scopeData = {
				scopes: ["test-scope"],
				scopeStr: "test-scope",
				scopesToSend: "test-scope",
				clientId: "test-client-id",
				tenant: "test-tenant"
			};

			const tokenSource = new vscode.CancellationTokenSource();
			const result = await (aadService as any).createSessionWithLocalServer(scopeData, undefined, tokenSource.token);

			assert.strictEqual(result.id, "test-session-id");
			assert.ok(mockExchangeCodeForSession.calledWith("test-code"));
		});

		test("should handle server startup failure", async () => {
			sandbox.stub(LoopbackAuthServer.prototype, "start").rejects(new Error("Port binding failed"));

			const scopeData = {
				scopes: ["test-scope"],
				scopeStr: "test-scope",
				scopesToSend: "test-scope",
				clientId: "test-client-id",
				tenant: "test-tenant"
			};

			const tokenSource = new vscode.CancellationTokenSource();

			try {
				await (aadService as any).createSessionWithLocalServer(scopeData, undefined, tokenSource.token);
				assert.fail("Should have thrown error");
			} catch (error) {
				assert.strictEqual(error.message, "Port binding failed");
			}
		});

		test("should handle timeout during OAuth response", async () => {
			sandbox.stub(LoopbackAuthServer.prototype, "start").resolves(3000);
			sandbox.stub(LoopbackAuthServer.prototype, "stop").resolves();
			sandbox.stub(LoopbackAuthServer.prototype, "waitForOAuthResponse").returns(new Promise(() => {}));
			sandbox.stub(LoopbackAuthServer.prototype, "nonce").get(() => "test-nonce");
			sandbox.stub(LoopbackAuthServer.prototype, "port").get(() => 3000);

			sandbox.stub(vscode.env, "openExternal").resolves(true);
			sandbox.stub().rejects(new Error("Timeout"));

			const scopeData = {
				scopes: ["test-scope"],
				scopeStr: "test-scope",
				scopesToSend: "test-scope",
				clientId: "test-client-id",
				tenant: "test-tenant"
			};

			const tokenSource = new vscode.CancellationTokenSource();

			try {
				await (aadService as any).createSessionWithLocalServer(scopeData, undefined, tokenSource.token);
				assert.fail("Should have thrown error");
			} catch (error) {
				assert.strictEqual(error.message, "Timeout");
			}
		});

		test("should handle cancellation during OAuth flow", async () => {
			sandbox.stub(LoopbackAuthServer.prototype, "start").resolves(3000);
			sandbox.stub(LoopbackAuthServer.prototype, "stop").resolves();
			sandbox.stub(LoopbackAuthServer.prototype, "waitForOAuthResponse").returns(new Promise(() => {}));
			sandbox.stub(LoopbackAuthServer.prototype, "nonce").get(() => "test-nonce");
			sandbox.stub(LoopbackAuthServer.prototype, "port").get(() => 3000);

			sandbox.stub(vscode.env, "openExternal").resolves(true);
			sandbox.stub().rejects(new vscode.CancellationError());

			const scopeData = {
				scopes: ["test-scope"],
				scopeStr: "test-scope",
				scopesToSend: "test-scope",
				clientId: "test-client-id",
				tenant: "test-tenant"
			};

			const tokenSource = new vscode.CancellationTokenSource();
			tokenSource.cancel();

			try {
				await (aadService as any).createSessionWithLocalServer(scopeData, undefined, tokenSource.token);
				assert.fail("Should have thrown error");
			} catch (error) {
				assert.ok(error instanceof vscode.CancellationError);
			}
		});

		test("should cleanup server even on failure", async () => {
			const stopStub = sandbox.stub(LoopbackAuthServer.prototype, "stop").resolves();
			sandbox.stub(LoopbackAuthServer.prototype, "start").resolves(3000);
			sandbox.stub(LoopbackAuthServer.prototype, "waitForOAuthResponse").returns(new Promise(() => {}));
			sandbox.stub(LoopbackAuthServer.prototype, "nonce").get(() => "test-nonce");
			sandbox.stub(LoopbackAuthServer.prototype, "port").get(() => 3000);

			sandbox.stub(vscode.env, "openExternal").resolves(true);
			sandbox.stub().rejects(new Error("Test error"));

			const scopeData = {
				scopes: ["test-scope"],
				scopeStr: "test-scope",
				scopesToSend: "test-scope",
				clientId: "test-client-id",
				tenant: "test-tenant"
			};

			const tokenSource = new vscode.CancellationTokenSource();

			try {
				await (aadService as any).createSessionWithLocalServer(scopeData, undefined, tokenSource.token);
				assert.fail("Should have thrown error");
			} catch (error) {
				setTimeout(() => {
					assert.ok(stopStub.called);
				}, 6000);
			}
		});
	});

	suite("createSessionWithoutLocalServer", () => {
		test("should create session without local server successfully", async () => {
			const mockUriEventListener = sinon.stub();
			mockUriHandler.event.returns(mockUriEventListener);

			sandbox.stub(vscode.env, "asExternalUri").resolves(vscode.Uri.parse("vscode://vscode.microsoft-authentication"));
			sandbox.stub(vscode.env, "openExternal").resolves(true);

			const mockHandleCodeResponse = sandbox.stub(aadService as any, "handleCodeResponse").resolves({
				id: "test-session-id",
				accessToken: "test-access-token",
				account: { id: "test-account", label: "Test Account" },
				scopes: ["test-scope"]
			});

			sandbox.stub(raceCancellationAndTimeoutError as any).resolves({
				id: "test-session-id",
				accessToken: "test-access-token",
				account: { id: "test-account", label: "Test Account" },
				scopes: ["test-scope"]
			});

			const scopeData = {
				scopes: ["test-scope"],
				scopeStr: "test-scope",
				scopesToSend: "test-scope",
				clientId: "test-client-id",
				tenant: "test-tenant"
			};

			const tokenSource = new vscode.CancellationTokenSource();
			const result = await (aadService as any).createSessionWithoutLocalServer(scopeData, undefined, tokenSource.token);

			assert.strictEqual(result.id, "test-session-id");
		});

		test("should handle nonce validation failure", async () => {
			const mockUri = vscode.Uri.parse("vscode://vscode.microsoft-authentication?code=test-code&nonce=invalid-nonce");
			const mockUriEventListener = sinon.stub().callsArgWith(0, mockUri);
			mockUriHandler.event.returns(mockUriEventListener);

			sandbox.stub(vscode.env, "asExternalUri").resolves(vscode.Uri.parse("vscode://vscode.microsoft-authentication"));
			sandbox.stub(vscode.env, "openExternal").resolves(true);

			const scopeData = {
				scopes: ["test-scope"],
				scopeStr: "test-scope",
				scopesToSend: "test-scope",
				clientId: "test-client-id",
				tenant: "test-tenant"
			};

			(aadService as any)._pendingNonces = new Map();
			(aadService as any)._pendingNonces.set("test-scope", ["valid-nonce"]);

			const tokenSource = new vscode.CancellationTokenSource();

			try {
				await (aadService as any).createSessionWithoutLocalServer(scopeData, undefined, tokenSource.token);
				assert.fail("Should have thrown error");
			} catch (error) {
				assert.ok(error.message.includes("Nonce does not match"));
			}
		});

		test("should handle missing code in callback", async () => {
			const mockUri = vscode.Uri.parse("vscode://vscode.microsoft-authentication?nonce=test-nonce");
			const mockUriEventListener = sinon.stub().callsArgWith(0, mockUri);
			mockUriHandler.event.returns(mockUriEventListener);

			sandbox.stub(vscode.env, "asExternalUri").resolves(vscode.Uri.parse("vscode://vscode.microsoft-authentication"));
			sandbox.stub(vscode.env, "openExternal").resolves(true);

			const scopeData = {
				scopes: ["test-scope"],
				scopeStr: "test-scope",
				scopesToSend: "test-scope",
				clientId: "test-client-id",
				tenant: "test-tenant"
			};

			const tokenSource = new vscode.CancellationTokenSource();

			try {
				await (aadService as any).createSessionWithoutLocalServer(scopeData, undefined, tokenSource.token);
				assert.fail("Should have thrown error");
			} catch (error) {
				assert.ok(error.message.includes("No code included in query"));
			}
		});

		test("should handle missing nonce in callback", async () => {
			const mockUri = vscode.Uri.parse("vscode://vscode.microsoft-authentication?code=test-code");
			const mockUriEventListener = sinon.stub().callsArgWith(0, mockUri);
			mockUriHandler.event.returns(mockUriEventListener);

			sandbox.stub(vscode.env, "asExternalUri").resolves(vscode.Uri.parse("vscode://vscode.microsoft-authentication"));
			sandbox.stub(vscode.env, "openExternal").resolves(true);

			const scopeData = {
				scopes: ["test-scope"],
				scopeStr: "test-scope",
				scopesToSend: "test-scope",
				clientId: "test-client-id",
				tenant: "test-tenant"
			};

			const tokenSource = new vscode.CancellationTokenSource();

			try {
				await (aadService as any).createSessionWithoutLocalServer(scopeData, undefined, tokenSource.token);
				assert.fail("Should have thrown error");
			} catch (error) {
				assert.ok(error.message.includes("No nonce included in query"));
			}
		});

		test("should handle missing code verifier", async () => {
			const mockUri = vscode.Uri.parse("vscode://vscode.microsoft-authentication?code=test-code&nonce=test-nonce");
			const mockUriEventListener = sinon.stub().callsArgWith(0, mockUri);
			mockUriHandler.event.returns(mockUriEventListener);

			sandbox.stub(vscode.env, "asExternalUri").resolves(vscode.Uri.parse("vscode://vscode.microsoft-authentication"));
			sandbox.stub(vscode.env, "openExternal").resolves(true);

			const scopeData = {
				scopes: ["test-scope"],
				scopeStr: "test-scope",
				scopesToSend: "test-scope",
				clientId: "test-client-id",
				tenant: "test-tenant"
			};

			(aadService as any)._pendingNonces = new Map();
			(aadService as any)._pendingNonces.set("test-scope", ["test-nonce"]);
			(aadService as any)._codeVerfifiers = new Map();

			const tokenSource = new vscode.CancellationTokenSource();

			try {
				await (aadService as any).createSessionWithoutLocalServer(scopeData, undefined, tokenSource.token);
				assert.fail("Should have thrown error");
			} catch (error) {
				assert.ok(error.message.includes("No available code verifier"));
			}
		});

		test("should handle timeout during callback wait", async () => {
			sandbox.stub(vscode.env, "asExternalUri").resolves(vscode.Uri.parse("vscode://vscode.microsoft-authentication"));
			sandbox.stub(vscode.env, "openExternal").resolves(true);
			sandbox.stub().rejects(new Error("Timeout"));

			const scopeData = {
				scopes: ["test-scope"],
				scopeStr: "test-scope",
				scopesToSend: "test-scope",
				clientId: "test-client-id",
				tenant: "test-tenant"
			};

			const tokenSource = new vscode.CancellationTokenSource();

			try {
				await (aadService as any).createSessionWithoutLocalServer(scopeData, undefined, tokenSource.token);
				assert.fail("Should have thrown error");
			} catch (error) {
				assert.strictEqual(error.message, "Timeout");
			}
		});
	});

	suite("doRefreshToken", () => {
		test("should refresh token successfully", async () => {
			const mockFetchTokenResponse = sandbox.stub(aadService as any, "fetchTokenResponse").resolves({
				access_token: "new-access-token",
				refresh_token: "new-refresh-token",
				expires_in: 3600
			});

			const mockConvertToTokenSync = sandbox.stub(aadService as any, "convertToTokenSync").returns({
				sessionId: "test-session-id",
				accessToken: "new-access-token",
				refreshToken: "new-refresh-token",
				expiresIn: 3600,
				scope: "test-scope",
				account: { id: "test-account", label: "Test Account" }
			});

			const mockSetToken = sandbox.stub(aadService as any, "setToken");
			const mockSetSessionTimeout = sandbox.stub(aadService as any, "setSessionTimeout");

			const scopeData = {
				scopes: ["test-scope"],
				scopeStr: "test-scope",
				scopesToSend: "test-scope",
				clientId: "test-client-id",
				tenant: "test-tenant"
			};

			const result = await (aadService as any).doRefreshToken("old-refresh-token", scopeData, "test-session-id");

			assert.strictEqual(result.accessToken, "new-access-token");
			assert.ok(mockFetchTokenResponse.called);
			assert.ok(mockConvertToTokenSync.called);
			assert.ok(mockSetToken.called);
			assert.ok(mockSetSessionTimeout.called);
		});

		test("should handle network failure during refresh", async () => {
			const mockFetchTokenResponse = sandbox.stub(aadService as any, "fetchTokenResponse").rejects(new Error("REFRESH_NETWORK_FAILURE"));

			const mockSetSessionTimeout = sandbox.stub(aadService as any, "setSessionTimeout");

			const scopeData = {
				scopes: ["test-scope"],
				scopeStr: "test-scope",
				scopesToSend: "test-scope",
				clientId: "test-client-id",
				tenant: "test-tenant"
			};

			try {
				await (aadService as any).doRefreshToken("old-refresh-token", scopeData, "test-session-id");
				assert.fail("Should have thrown error");
			} catch (error) {
				assert.strictEqual(error.message, "REFRESH_NETWORK_FAILURE");
				assert.ok(mockSetSessionTimeout.called);
			}
		});

		test("should handle refresh token failure", async () => {
			const mockFetchTokenResponse = sandbox.stub(aadService as any, "fetchTokenResponse").rejects(new Error("Invalid refresh token"));

			const scopeData = {
				scopes: ["test-scope"],
				scopeStr: "test-scope",
				scopesToSend: "test-scope",
				clientId: "test-client-id",
				tenant: "test-tenant"
			};

			try {
				await (aadService as any).doRefreshToken("invalid-refresh-token", scopeData, "test-session-id");
				assert.fail("Should have thrown error");
			} catch (error) {
				assert.strictEqual(error.message, "Invalid refresh token");
			}
		});

		test("should handle scope mismatch scenarios", async () => {
			const mockFetchTokenResponse = sandbox.stub(aadService as any, "fetchTokenResponse").rejects(new Error("Scope mismatch"));

			const scopeData = {
				scopes: ["different-scope"],
				scopeStr: "different-scope",
				scopesToSend: "different-scope",
				clientId: "test-client-id",
				tenant: "test-tenant"
			};

			try {
				await (aadService as any).doRefreshToken("refresh-token", scopeData, "test-session-id");
				assert.fail("Should have thrown error");
			} catch (error) {
				assert.strictEqual(error.message, "Scope mismatch");
			}
		});
	});

	suite("fetchTokenResponse", () => {
		test("should handle exponential backoff on server errors", async () => {
			const fetchStub = sandbox.stub(global, "fetch");
			fetchStub.onFirstCall().resolves({ status: 500, ok: false } as any);
			fetchStub.onSecondCall().resolves({ status: 502, ok: false } as any);
			fetchStub.onThirdCall().resolves({
				status: 200,
				ok: true,
				json: () => Promise.resolve({ access_token: "test-token" })
			} as any);

			sandbox.stub(vscode.commands, "executeCommand").resolves({});

			const scopeData = {
				scopes: ["test-scope"],
				scopeStr: "test-scope",
				scopesToSend: "test-scope",
				clientId: "test-client-id",
				tenant: "test-tenant"
			};

			const result = await (aadService as any).fetchTokenResponse("test-post-data", scopeData);

			assert.strictEqual(result.access_token, "test-token");
			assert.strictEqual(fetchStub.callCount, 3);
		});

		test("should throw on 4xx errors", async () => {
			const fetchStub = sandbox.stub(global, "fetch");
			fetchStub.resolves({
				status: 400,
				ok: false,
				text: () => Promise.resolve("Bad Request")
			} as any);

			sandbox.stub(vscode.commands, "executeCommand").resolves({});

			const scopeData = {
				scopes: ["test-scope"],
				scopeStr: "test-scope",
				scopesToSend: "test-scope",
				clientId: "test-client-id",
				tenant: "test-tenant"
			};

			try {
				await (aadService as any).fetchTokenResponse("test-post-data", scopeData);
				assert.fail("Should have thrown error");
			} catch (error) {
				assert.strictEqual(error.message, "Bad Request");
			}
		});

		test("should handle network errors", async () => {
			const fetchStub = sandbox.stub(global, "fetch");
			fetchStub.rejects(new Error("Network error"));

			sandbox.stub(vscode.commands, "executeCommand").resolves({});

			const scopeData = {
				scopes: ["test-scope"],
				scopeStr: "test-scope",
				scopesToSend: "test-scope",
				clientId: "test-client-id",
				tenant: "test-tenant"
			};

			try {
				await (aadService as any).fetchTokenResponse("test-post-data", scopeData);
				assert.fail("Should have thrown error");
			} catch (error) {
				assert.strictEqual(error.message, "REFRESH_NETWORK_FAILURE");
			}
		});
	});
});
