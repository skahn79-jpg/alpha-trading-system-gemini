import Foundation
@testable import AlphaTrading

final class StubURLProtocol: URLProtocol {
    static var handler: ((URLRequest) throws -> (Int, Data))?
    static var lastRequest: URLRequest?
    static var recordedPaths: [String] = []
    static var responseDelay: TimeInterval = 0

    private var stopped = false

    static func reset() {
        handler = nil
        lastRequest = nil
        recordedPaths = []
        responseDelay = 0
    }

    static func makeStubAPIClient() -> APIClient {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return APIClient(session: URLSession(configuration: config))
    }

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        let delay = Self.responseDelay
        let current = request
        DispatchQueue.global().asyncAfter(deadline: .now() + delay) { [weak self] in
            self?.finish(current)
        }
    }

    override func stopLoading() {
        stopped = true
    }

    private func finish(_ current: URLRequest) {
        guard !stopped else { return }
        Self.lastRequest = current
        Self.recordedPaths.append(current.url?.path ?? "")
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet))
            return
        }
        do {
            let (status, data) = try handler(current)
            let url = current.url ?? URL(string: "https://example.invalid")!
            guard let response = HTTPURLResponse(
                url: url,
                statusCode: status,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            ) else {
                client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
                return
            }
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }
}
