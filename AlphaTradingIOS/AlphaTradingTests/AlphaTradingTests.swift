import XCTest

final class AlphaTradingTests: XCTestCase {
    func testSmoke() {
        XCTAssertTrue(true)
    }

    func testVersionStringFormat() {
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0"
        XCTAssertFalse(version.isEmpty)
    }
}
