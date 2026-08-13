import XCTest
@testable import AlphaTrading

final class APIClientAuthTests: XCTestCase {
    private struct Dummy: Decodable {}

    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
    }

    override func tearDown() {
        StubURLProtocol.reset()
        super.tearDown()
    }

    func testClassifyBrokerAndAuthPaths() {
        XCTAssertEqual(APIAuthScope.classify("/api/broker/status"), .adminSession)
        XCTAssertEqual(APIAuthScope.classify("/api/broker"), .adminSession)
        XCTAssertEqual(APIAuthScope.classify("/api/trading/balance"), .adminSession)
        XCTAssertEqual(APIAuthScope.classify("/api/auth/login"), .adminLogin)
        XCTAssertEqual(APIAuthScope.classify("/api/auth/session"), .adminSession)
        XCTAssertEqual(APIAuthScope.classify("/api/auth/logout"), .adminSession)
        XCTAssertEqual(APIAuthScope.classify("/api/index"), .market)
        XCTAssertEqual(APIAuthScope.classify("/api/ai/chat"), .appKey)
    }

    func testRequestDoesNotSetCookieOrBearerHeaders() async throws {
        StubURLProtocol.handler = { _ in
            (200, Data("{\"authenticated\":false}".utf8))
        }
        let client = StubURLProtocol.makeStubAPIClient()
        let _: SessionResponse = try await client.get("/api/auth/session")
        guard let request = StubURLProtocol.lastRequest else {
            XCTFail("missing request")
            return
        }
        XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        XCTAssertNil(request.value(forHTTPHeaderField: "Origin"))
        XCTAssertNil(request.value(forHTTPHeaderField: "Referer"))
        let authorization = request.value(forHTTPHeaderField: "Authorization") ?? ""
        XCTAssertFalse(authorization.hasPrefix("Bearer "))
    }

    func testBroker401PostsAdminSessionNotification() async {
        let exp = expectation(description: "admin session unauthorized")
        let observer = NotificationCenter.default.addObserver(
            forName: .alphaAdminSessionUnauthorized,
            object: nil,
            queue: .main
        ) { _ in
            exp.fulfill()
        }
        defer { NotificationCenter.default.removeObserver(observer) }

        StubURLProtocol.handler = { _ in (401, Data("{}".utf8)) }
        let client = StubURLProtocol.makeStubAPIClient()
        do {
            let _: BrokerStatus = try await client.get("/api/broker/status")
            XCTFail("expected unauthorized")
        } catch {
            XCTAssertEqual(error as? APIError, .unauthorized)
        }
        await fulfillment(of: [exp], timeout: 1)
    }

    func testIndex401DoesNotPostAdminSessionNotification() async throws {
        var posted = false
        let observer = NotificationCenter.default.addObserver(
            forName: .alphaAdminSessionUnauthorized,
            object: nil,
            queue: .main
        ) { _ in
            posted = true
        }
        defer { NotificationCenter.default.removeObserver(observer) }

        StubURLProtocol.handler = { _ in (401, Data("{}".utf8)) }
        let client = StubURLProtocol.makeStubAPIClient()
        do {
            let _: Dummy = try await client.get("/api/index")
            XCTFail("expected invalidResponse")
        } catch {
            XCTAssertEqual(error as? APIError, .invalidResponse)
        }
        try await Task.sleep(nanoseconds: 120_000_000)
        XCTAssertFalse(posted)
    }

    func testLogin401DoesNotPostAdminSessionNotification() async throws {
        var posted = false
        let observer = NotificationCenter.default.addObserver(
            forName: .alphaAdminSessionUnauthorized,
            object: nil,
            queue: .main
        ) { _ in
            posted = true
        }
        defer { NotificationCenter.default.removeObserver(observer) }

        StubURLProtocol.handler = { _ in (401, Data("{}".utf8)) }
        let client = StubURLProtocol.makeStubAPIClient()
        do {
            let _: SessionResponse = try await client.post(
                "/api/auth/login",
                body: LoginRequest(loginId: "tester", password: "invalid")
            )
            XCTFail("expected unauthorized")
        } catch {
            XCTAssertEqual(error as? APIError, .unauthorized)
        }
        try await Task.sleep(nanoseconds: 120_000_000)
        XCTAssertFalse(posted)
    }

    func testTimedOutMapsToTimeout() async {
        StubURLProtocol.handler = { _ in
            throw URLError(.timedOut)
        }
        let client = StubURLProtocol.makeStubAPIClient()
        do {
            let _: SessionResponse = try await client.get("/api/auth/session")
            XCTFail("expected timeout")
        } catch {
            XCTAssertEqual(error as? APIError, .timeout)
        }
    }

    func testTransportErrorMapsToTransport() async {
        StubURLProtocol.handler = { _ in
            throw URLError(.notConnectedToInternet)
        }
        let client = StubURLProtocol.makeStubAPIClient()
        do {
            let _: SessionResponse = try await client.get("/api/auth/session")
            XCTFail("expected transport")
        } catch {
            XCTAssertEqual(error as? APIError, .transport)
        }
    }
}
