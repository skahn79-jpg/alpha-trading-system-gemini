import Foundation
import Security
import CommonCrypto

/// Render API 호스트 검증 + 선택적 공개키 핀닝.
/// `PINNED_PUBLIC_KEY_HASHES`가 비어 있으면 시스템 신뢰 + 호스트 검증만 수행합니다.
final class CertificatePinningDelegate: NSObject, URLSessionDelegate {
    static let shared = CertificatePinningDelegate()

    private let pinnedHost: String
    private let pinnedHashes: Set<String>

    override init() {
        pinnedHost = (Bundle.main.object(forInfoDictionaryKey: "PINNED_API_HOST") as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased() ?? "alpha-trading-server.onrender.com"
        let raw = Bundle.main.object(forInfoDictionaryKey: "PINNED_PUBLIC_KEY_HASHES") as? String ?? ""
        pinnedHashes = Set(
            raw.split(separator: ",")
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
        )
        super.init()
    }

    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }

        let host = challenge.protectionSpace.host.lowercased()
        guard host == pinnedHost || host.hasSuffix(".\(pinnedHost)") else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        #if DEBUG
        if pinnedHashes.isEmpty {
            completionHandler(.useCredential, URLCredential(trust: trust))
            return
        }
        #endif

        var error: CFError?
        guard SecTrustEvaluateWithError(trust, &error) else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        if pinnedHashes.isEmpty {
            completionHandler(.useCredential, URLCredential(trust: trust))
            return
        }

        guard let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
              let serverCert = chain.first,
              let publicKey = SecCertificateCopyKey(serverCert),
              let keyData = SecKeyCopyExternalRepresentation(publicKey, nil) as Data? else {
            completionHandler(.cancelAuthenticationChallenge, nil)
            return
        }

        let hash = sha256Base64(keyData)
        if pinnedHashes.contains(hash) {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }

    private func sha256Base64(_ data: Data) -> String {
        var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        data.withUnsafeBytes { buffer in
            _ = CC_SHA256(buffer.baseAddress, CC_LONG(buffer.count), &hash)
        }
        return Data(hash).base64EncodedString()
    }
}
