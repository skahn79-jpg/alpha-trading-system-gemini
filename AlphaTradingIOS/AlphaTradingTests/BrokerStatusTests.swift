import XCTest
@testable import AlphaTrading

@MainActor
final class BrokerStatusTests: XCTestCase {
    override func setUp() {
        super.setUp()
        StubURLProtocol.reset()
    }

    override func tearDown() {
        StubURLProtocol.reset()
        super.tearDown()
    }

    func testInquiryFlagsRemainDisabled() {
        XCTAssertFalse(KBInquiryPolicy.networkEnabled)
        XCTAssertFalse(KBInquiryPolicy.orderControlsEnabled)
    }

    func testBrokerStatusCopyStrings() {
        XCTAssertEqual(BrokerStatusCopy.configuredNeededTitle, "KB API 설정 필요")
        XCTAssertEqual(BrokerStatusCopy.configuredNeededDetail, "앱키가 아직 등록되지 않았습니다.")
        XCTAssertEqual(BrokerStatusCopy.connectionUnverifiedTitle, "연결 미검증")
        XCTAssertEqual(BrokerStatusCopy.connectionUnverifiedDetail, "실서버 조회 검증이 완료되지 않았습니다.")
        XCTAssertEqual(BrokerStatusCopy.tradingDisabled, "직접 주문: 비활성")
        XCTAssertEqual(BrokerStatusCopy.autoTradingDisabled, "자동매매: 비활성")
        XCTAssertEqual(BrokerStatusCopy.inquiryPending, "준비 중")
        XCTAssertEqual(BrokerStatusCopy.inquiryRows, [
            "현재가 조회",
            "계좌 요약",
            "보유 종목",
            "주문 가능 금액",
            "주문·체결 조회",
        ])
        XCTAssertEqual(BrokerStatusCopy.configurationTitle(configured: false), "KB API 설정 필요")
        XCTAssertEqual(BrokerStatusCopy.configurationTitle(configured: true), "KB API 설정됨")
        XCTAssertEqual(BrokerStatusCopy.configurationDetail(configured: false), "앱키가 아직 등록되지 않았습니다.")
        XCTAssertNil(BrokerStatusCopy.configurationDetail(configured: true))
        XCTAssertEqual(BrokerStatusCopy.connectionTitle("unverified"), "연결 미검증")
        XCTAssertEqual(BrokerStatusCopy.connectionDetail("unverified"), "실서버 조회 검증이 완료되지 않았습니다.")
        XCTAssertEqual(BrokerStatusCopy.tradingLabel(enabled: false), "직접 주문: 비활성")
        XCTAssertEqual(BrokerStatusCopy.autoTradingLabel(enabled: false), "자동매매: 비활성")
        XCTAssertEqual(BrokerStatusCopy.tradingLabel(enabled: true), "직접 주문: 활성")
        XCTAssertEqual(BrokerStatusCopy.autoTradingLabel(enabled: true), "자동매매: 활성")
    }

    func testBrokerStatusDecoding() throws {
        let json = """
        {"configured":false,"connection":"unverified","tradingEnabled":false,"autoTradingEnabled":false}
        """
        let status = try JSONDecoder().decode(BrokerStatus.self, from: Data(json.utf8))
        XCTAssertFalse(status.configured)
        XCTAssertEqual(status.connection, "unverified")
        XCTAssertFalse(status.tradingEnabled)
        XCTAssertFalse(status.autoTradingEnabled)
    }

    func testLoadFetchesBrokerStatusOnlyNeverQuotesOrBalance() async {
        StubURLProtocol.handler = { request in
            (200, Data("{\"configured\":false,\"connection\":\"unverified\",\"tradingEnabled\":false,\"autoTradingEnabled\":false}".utf8))
        }
        let service = AdminAuthService(client: StubURLProtocol.makeStubAPIClient())
        let vm = BrokerStatusViewModel(service: service)
        await vm.load()
        XCTAssertEqual(StubURLProtocol.recordedPaths, ["/api/broker/status"])
        XCTAssertFalse(StubURLProtocol.recordedPaths.contains { $0.contains("/api/trading") })
        XCTAssertFalse(StubURLProtocol.recordedPaths.contains { $0.contains("quotes") })
        XCTAssertFalse(StubURLProtocol.recordedPaths.contains { $0.contains("balance") })
        XCTAssertEqual(vm.status?.configured, false)
        XCTAssertEqual(vm.status?.connection, "unverified")
        XCTAssertNil(vm.errorMessage)
        XCTAssertFalse(KBInquiryPolicy.networkEnabled)
    }

    func testLoadErrorDoesNotInventQuoteData() async {
        StubURLProtocol.handler = { _ in (503, Data("{}".utf8)) }
        let service = AdminAuthService(client: StubURLProtocol.makeStubAPIClient())
        let vm = BrokerStatusViewModel(service: service)
        await vm.load()
        XCTAssertNil(vm.status)
        XCTAssertEqual(vm.errorMessage, APIError.serverUnavailable.localizedDescription)
        XCTAssertEqual(StubURLProtocol.recordedPaths, ["/api/broker/status"])
    }
}
