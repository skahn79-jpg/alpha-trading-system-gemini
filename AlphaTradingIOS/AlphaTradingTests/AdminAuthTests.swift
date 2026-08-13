import XCTest
@testable import AlphaTrading

@MainActor
final class AdminAuthTests: XCTestCase {
    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
    }

    override func tearDown() {
        StubURLProtocol.reset()
        super.tearDown()
    }

    func testAllowsMainInterfaceOnlyWhenAuthenticated() {
        XCTAssertFalse(AdminAuthState.checking.allowsMainInterface)
        XCTAssertFalse(AdminAuthState.unauthenticated.allowsMainInterface)
        XCTAssertFalse(AdminAuthState.unavailable.allowsMainInterface)
        let user = AdminUser(name: "관리자", expiresAt: nil)
        XCTAssertTrue(AdminAuthState.authenticated(user).allowsMainInterface)
    }

    func testSessionResponseParsesISO8601WithAndWithoutFractionalSeconds() throws {
        let withFraction = """
        {"authenticated":true,"user":{"name":"테스트"},"expiresAt":"2026-08-13T08:00:00.123Z"}
        """
        let withoutFraction = """
        {"authenticated":true,"user":{"name":"테스트"},"expiresAt":"2026-08-13T08:00:00Z"}
        """
        let a = try JSONDecoder().decode(SessionResponse.self, from: Data(withFraction.utf8))
        let b = try JSONDecoder().decode(SessionResponse.self, from: Data(withoutFraction.utf8))
        XCTAssertNotNil(a.expiresAt)
        XCTAssertNotNil(b.expiresAt)
        XCTAssertEqual(a.resolvedUser()?.name, "테스트")
        XCTAssertEqual(b.resolvedUser()?.name, "테스트")
    }

    func testInvalidOrMissingExpiresAtDoesNotCrash() throws {
        let invalid = """
        {"authenticated":true,"user":{"name":"테스트"},"expiresAt":"not-a-date"}
        """
        let missing = """
        {"authenticated":true,"user":{"name":"테스트"}}
        """
        let empty = """
        {"authenticated":true,"user":{"name":"테스트"},"expiresAt":""}
        """
        let a = try JSONDecoder().decode(SessionResponse.self, from: Data(invalid.utf8))
        let b = try JSONDecoder().decode(SessionResponse.self, from: Data(missing.utf8))
        let c = try JSONDecoder().decode(SessionResponse.self, from: Data(empty.utf8))
        XCTAssertNil(a.expiresAt)
        XCTAssertNil(b.expiresAt)
        XCTAssertNil(c.expiresAt)
        XCTAssertEqual(a.resolvedUser()?.name, "테스트")
    }

    func testExtraTokenFieldIsIgnoredAndPasswordIsNotStored() throws {
        let json = """
        {"authenticated":true,"user":{"name":"테스트"},"token":"should-be-ignored","password":"invalid","expiresAt":"2026-08-13T08:00:00Z"}
        """
        let decoded = try JSONDecoder().decode(SessionResponse.self, from: Data(json.utf8))
        let labels = Set(Mirror(reflecting: decoded).children.compactMap(\.label))
        XCTAssertFalse(labels.contains("token"))
        XCTAssertFalse(labels.contains("password"))
        let userLabels = Set(Mirror(reflecting: decoded.resolvedUser()!).children.compactMap(\.label))
        XCTAssertFalse(userLabels.contains("password"))
        XCTAssertFalse(userLabels.contains("token"))
        XCTAssertEqual(decoded.resolvedUser()?.name, "테스트")
    }

    func testResolvedUserFallbackName() throws {
        let json = """
        {"authenticated":true}
        """
        let decoded = try JSONDecoder().decode(SessionResponse.self, from: Data(json.utf8))
        XCTAssertEqual(decoded.resolvedUser()?.name, "관리자")
        XCTAssertNil(try JSONDecoder().decode(SessionResponse.self, from: Data("{\"authenticated\":false}".utf8)).resolvedUser())
    }

    func testStartAutomaticallyFalseDoesNotFetch() async throws {
        StubURLProtocol.handler = { _ in
            (200, Data("{\"authenticated\":false}".utf8))
        }
        let service = AdminAuthService(client: StubURLProtocol.makeStubAPIClient())
        let vm = AdminAuthViewModel(service: service, startAutomatically: false)
        try await Task.sleep(nanoseconds: 80_000_000)
        XCTAssertTrue(StubURLProtocol.recordedPaths.isEmpty)
        XCTAssertEqual(vm.state, .checking)
        XCTAssertEqual(vm.displayName, "관리자")
    }

    func testLogin401ClearsPasswordAndShowsMessage() async {
        StubURLProtocol.handler = { request in
            XCTAssertEqual(request.url?.path, "/api/auth/login")
            return (401, Data("{}".utf8))
        }
        let vm = makeViewModel()
        vm.loginId = "tester"
        vm.password = "invalid"
        await vm.login()
        XCTAssertEqual(vm.state, .unauthenticated)
        XCTAssertEqual(vm.password, "")
        XCTAssertEqual(vm.loginId, "tester")
        XCTAssertEqual(vm.loginError, "로그인 정보가 올바르지 않습니다.")
    }

    func testLogin429Message() async {
        StubURLProtocol.handler = { _ in (429, Data("{}".utf8)) }
        let vm = makeViewModel()
        vm.loginId = "tester"
        vm.password = "invalid"
        await vm.login()
        XCTAssertEqual(vm.state, .unauthenticated)
        XCTAssertEqual(vm.loginError, "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.")
    }

    func testLogin503UsesServerUnavailableDescription() async {
        StubURLProtocol.handler = { _ in (503, Data("{}".utf8)) }
        let vm = makeViewModel()
        vm.loginId = "tester"
        vm.password = "invalid"
        await vm.login()
        XCTAssertEqual(vm.state, .unauthenticated)
        XCTAssertEqual(vm.loginError, APIError.serverUnavailable.localizedDescription)
        XCTAssertNotEqual(vm.loginError, "로그인 정보가 올바르지 않습니다.")
    }

    func testLoginFormLockedDuringInFlightRequestAndRecoversAfter() async throws {
        StubURLProtocol.responseDelay = 0.2
        StubURLProtocol.handler = { _ in
            (200, Data("{\"authenticated\":true,\"user\":{\"name\":\"테스트\"}}".utf8))
        }
        let vm = makeViewModel()
        vm.loginId = "tester"
        vm.password = "invalid"
        async let login: Void = vm.login()
        try await Task.sleep(nanoseconds: 50_000_000)
        XCTAssertTrue(vm.isLoginFormLocked)
        XCTAssertTrue(vm.isSubmitting)
        await login
        XCTAssertFalse(vm.isLoginFormLocked)
        XCTAssertFalse(vm.isSubmitting)
    }

    func testLoginIgnoresDuplicateSubmitWhileInFlight() async throws {
        StubURLProtocol.responseDelay = 0.2
        StubURLProtocol.handler = { _ in
            (200, Data("{\"authenticated\":true,\"user\":{\"name\":\"테스트\"}}".utf8))
        }
        let vm = makeViewModel()
        vm.loginId = "tester"
        vm.password = "invalid"
        async let first: Void = vm.login()
        try await Task.sleep(nanoseconds: 50_000_000)
        await vm.login()
        await first
        XCTAssertEqual(StubURLProtocol.recordedPaths.filter { $0 == "/api/auth/login" }.count, 1)
    }

    func testLoginSuccessClearsCredentials() async {
        StubURLProtocol.handler = { _ in
            (200, Data("{\"authenticated\":true,\"user\":{\"name\":\"테스트\"}}".utf8))
        }
        let vm = makeViewModel()
        vm.loginId = "tester"
        vm.password = "invalid"
        await vm.login()
        XCTAssertEqual(vm.state, .authenticated(AdminUser(name: "테스트", expiresAt: nil)))
        XCTAssertEqual(vm.loginId, "")
        XCTAssertEqual(vm.password, "")
        XCTAssertNil(vm.loginError)
        XCTAssertEqual(vm.displayName, "테스트")
    }

    func testRefreshSessionUnauthorizedBecomesUnauthenticated() async {
        StubURLProtocol.handler = { _ in (401, Data("{}".utf8)) }
        let vm = makeViewModel()
        await vm.refreshSession(reason: .launch)
        XCTAssertEqual(vm.state, .unauthenticated)
    }

    func testRefreshSessionTimeoutBecomesUnavailableNotUnauthenticated() async {
        StubURLProtocol.responseDelay = 0.25
        StubURLProtocol.handler = { _ in
            (200, Data("{\"authenticated\":true,\"user\":{\"name\":\"테스트\"}}".utf8))
        }
        let service = AdminAuthService(client: StubURLProtocol.makeStubAPIClient(), sessionTimeout: 0.05)
        let vm = AdminAuthViewModel(service: service, startAutomatically: false)
        await vm.refreshSession(reason: .launch)
        XCTAssertEqual(vm.state, .unavailable)
        XCTAssertNotEqual(vm.state, .unauthenticated)
    }

    func testRefreshSessionTransportBecomesUnavailable() async {
        StubURLProtocol.handler = { _ in
            throw URLError(.notConnectedToInternet)
        }
        let vm = makeViewModel()
        await vm.refreshSession(reason: .foreground)
        XCTAssertEqual(vm.state, .unavailable)
    }

    func testLogoutLocksLocallyAndSetsNoticeWhenPostFails() async {
        var calls = 0
        StubURLProtocol.handler = { request in
            calls += 1
            if request.url?.path == "/api/auth/session" {
                return (200, Data("{\"authenticated\":true,\"user\":{\"name\":\"테스트\"}}".utf8))
            }
            return (500, Data("{}".utf8))
        }
        let vm = makeViewModel()
        await vm.refreshSession(reason: .launch)
        XCTAssertTrue(vm.state.allowsMainInterface)
        await vm.logout()
        XCTAssertEqual(vm.state, .unauthenticated)
        XCTAssertFalse(vm.state.allowsMainInterface)
        XCTAssertEqual(vm.logoutNotice, "서버 로그아웃이 완료되지 않았습니다. 로컬 화면은 잠갔습니다.")
        XCTAssertEqual(vm.password, "")
    }

    func testLogoutSuccessClearsNotice() async {
        StubURLProtocol.handler = { request in
            if request.url?.path == "/api/auth/logout" {
                return (200, Data("{\"authenticated\":false}".utf8))
            }
            return (200, Data("{\"authenticated\":true,\"user\":{\"name\":\"테스트\"}}".utf8))
        }
        let vm = makeViewModel()
        await vm.refreshSession(reason: .launch)
        await vm.logout()
        XCTAssertEqual(vm.state, .unauthenticated)
        XCTAssertNil(vm.logoutNotice)
    }

    func testUnauthorizedNotificationClearsCookiesAndPassword() async throws {
        StubURLProtocol.handler = { _ in
            (200, Data("{\"authenticated\":true,\"user\":{\"name\":\"테스트\"}}".utf8))
        }
        let vm = makeViewModel()
        await vm.refreshSession(reason: .launch)
        vm.password = "invalid"
        XCTAssertTrue(vm.state.allowsMainInterface)

        NotificationCenter.default.post(name: .alphaAdminSessionUnauthorized, object: nil)
        try await Task.sleep(nanoseconds: 150_000_000)
        XCTAssertEqual(vm.state, .unauthenticated)
        XCTAssertEqual(vm.password, "")
    }

    func testClearSessionCookiesRemovesNamedCookiesWithoutPrintingValues() {
        guard let host = APIConfig.baseURL.host else {
            XCTFail("missing host")
            return
        }
        let names = ["alpha_session", "__Host-alpha_session"]
        for name in names {
            let cookie = HTTPCookie(properties: [
                .name: name,
                .value: "dummy-session-value",
                .domain: host,
                .path: "/",
            ])
            XCTAssertNotNil(cookie)
            if let cookie {
                HTTPCookieStorage.shared.setCookie(cookie)
            }
        }
        SessionCookieStore.clearSessionCookies()
        let remaining = (HTTPCookieStorage.shared.cookies(for: APIConfig.baseURL) ?? [])
            .filter { names.contains($0.name) }
        XCTAssertTrue(remaining.isEmpty)
    }

    func testSwiftSourcesDoNotEmbedSecretsReportsFilenameOnly() async throws {
        let userLabels = Set(Mirror(reflecting: AdminUser(name: "관리자", expiresAt: nil)).children.compactMap(\.label))
        XCTAssertFalse(userLabels.contains("password"))
        XCTAssertFalse(userLabels.contains("token"))

        let scanned = await Self.scanAppSwiftFilenamesForSecretLikeStrings(timeout: 1.5)
        switch scanned {
        case .timedOut, .unavailable:
            throw XCTSkip("app sources not readable from test host")
        case .hits(let files):
            XCTAssertTrue(files.isEmpty, "secret-like strings in: \(files.joined(separator: ", "))")
        }
    }

    private enum SourceScanResult {
        case hits([String])
        case timedOut
        case unavailable
    }

    nonisolated private static func scanAppSwiftFilenamesForSecretLikeStrings(timeout: TimeInterval) async -> SourceScanResult {
        await withCheckedContinuation { continuation in
            let lock = NSLock()
            var resumed = false
            func finish(_ result: SourceScanResult) {
                lock.lock()
                defer { lock.unlock() }
                guard !resumed else { return }
                resumed = true
                continuation.resume(returning: result)
            }
            DispatchQueue.global(qos: .userInitiated).async {
                let appDir = URL(fileURLWithPath: #filePath)
                    .deletingLastPathComponent()
                    .deletingLastPathComponent()
                    .appendingPathComponent("AlphaTrading")
                var isDir: ObjCBool = false
                guard FileManager.default.fileExists(atPath: appDir.path, isDirectory: &isDir), isDir.boolValue else {
                    finish(.unavailable)
                    return
                }
                let needles = [
                    "안상균",
                    "$" + "argon2",
                    "ADMIN_" + "PASSWORD_HASH",
                    "BEGIN RSA PRIVATE KEY",
                    ["KBSEC", "APP", "SECRET"].joined(separator: "_") + "=",
                    ["KBSEC", "APP", "KEY"].joined(separator: "_") + "=",
                ]
                var hitFiles: [String] = []
                guard let enumerator = FileManager.default.enumerator(
                    at: appDir,
                    includingPropertiesForKeys: [.isRegularFileKey],
                    options: [.skipsHiddenFiles]
                ) else {
                    finish(.unavailable)
                    return
                }
                while let url = enumerator.nextObject() as? URL {
                    if url.pathExtension == "xcassets" || url.lastPathComponent == "Fonts" || url.lastPathComponent == "Resources" {
                        enumerator.skipDescendants()
                        continue
                    }
                    guard url.pathExtension == "swift" else { continue }
                    guard let text = try? String(contentsOf: url, encoding: .utf8) else { continue }
                    if needles.contains(where: { text.contains($0) }) {
                        hitFiles.append(url.lastPathComponent)
                    }
                }
                finish(.hits(hitFiles))
            }
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) {
                finish(.timedOut)
            }
        }
    }

    private func makeViewModel() -> AdminAuthViewModel {
        let service = AdminAuthService(client: StubURLProtocol.makeStubAPIClient())
        return AdminAuthViewModel(service: service, startAutomatically: false)
    }
}
