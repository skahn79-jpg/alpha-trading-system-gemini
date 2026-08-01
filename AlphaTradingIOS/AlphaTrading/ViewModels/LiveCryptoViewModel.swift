import Foundation

/// 실시간 청산 이벤트
struct LiquidationEvent: Identifiable {
    let id = UUID()
    let time: Date
    let symbol: String
    let isLongLiquidation: Bool // 매도 청산 = 롱 포지션 강제 종료
    let price: Double
    let usdValue: Double
}

/// 가격대별 청산 누적 (세션 동안)
struct LiquidationBucket: Identifiable {
    var id: Double { priceLow }
    let priceLow: Double
    let priceHigh: Double
    var longUsd: Double = 0
    var shortUsd: Double = 0

    var totalUsd: Double { longUsd + shortUsd }
    var midPrice: Double { (priceLow + priceHigh) / 2 }
}

/// 실시간 크립토 모니터 (CoinAI 청산맵 벤치마킹)
///  · 가격: Binance 현물 WebSocket (국내망에서 선물 스트림은 차단되는 경우가 있어 현물 사용)
///  · 청산: OKX 공개 liquidation-orders WebSocket (전 SWAP 청산 푸시 → 심볼 필터)
///  탭 진입 시 연결 · 이탈 시 해제 (배터리 보호)
@MainActor
final class LiveCryptoViewModel: NSObject, ObservableObject {
    @Published var symbol = "BTC"
    @Published var price: Double = 0
    @Published var changePct: Double = 0
    @Published var connected = false
    @Published var liqConnected = false
    @Published var events: [LiquidationEvent] = []
    @Published var longTotalUsd: Double = 0
    @Published var shortTotalUsd: Double = 0
    @Published var buckets: [LiquidationBucket] = []
    @Published var minuteCloses: [Double] = []

    private var priceSocket: URLSessionWebSocketTask?
    private var liqSocket: URLSessionWebSocketTask?
    private var okxPingTask: Task<Void, Never>?
    // 거래소 공개 스트림용 일반 세션 (앱 API 피닝 세션과 분리)
    private lazy var session = URLSession(configuration: .default)

    private var bucketStep: Double { symbol == "BTC" ? 100 : 10 }
    /// OKX 계약 가치 (1계약당 코인 수량) — USD 환산용
    private var contractValue: Double { symbol == "BTC" ? 0.01 : 0.1 }
    private var okxInstPrefix: String { "\(symbol)-USDT" }

    func start() async {
        stop()
        events = []
        longTotalUsd = 0
        shortTotalUsd = 0
        buckets = []
        await loadKlines()
        connectPrice()
        connectLiquidations()
    }

    func stop() {
        priceSocket?.cancel(with: .goingAway, reason: nil)
        priceSocket = nil
        liqSocket?.cancel(with: .goingAway, reason: nil)
        liqSocket = nil
        okxPingTask?.cancel()
        okxPingTask = nil
        connected = false
        liqConnected = false
    }

    func switchSymbol(_ newSymbol: String) async {
        symbol = newSymbol
        await start()
    }

    // MARK: - 초기 1분봉 (Binance 현물 REST)

    private func loadKlines() async {
        guard let url = URL(string: "https://api.binance.com/api/v3/klines?symbol=\(symbol)USDT&interval=1m&limit=60") else { return }
        do {
            let (data, _) = try await session.data(from: url)
            guard let rows = try JSONSerialization.jsonObject(with: data) as? [[Any]] else { return }
            minuteCloses = rows.compactMap { row in
                (row.count > 4 ? row[4] as? String : nil).flatMap(Double.init)
            }
            if let last = minuteCloses.last { price = last }
            if let first = minuteCloses.first, let last = minuteCloses.last, first > 0 {
                changePct = (last - first) / first * 100
            }
        } catch {
            // REST 실패해도 WS는 시도
        }
    }

    // MARK: - 가격 스트림 (Binance 현물)

    private func connectPrice() {
        guard let url = URL(string: "wss://stream.binance.com:9443/stream?streams=\(symbol.lowercased())usdt@miniTicker") else { return }
        let task = session.webSocketTask(with: url)
        priceSocket = task
        task.resume()
        receivePriceLoop()
    }

    private func receivePriceLoop() {
        priceSocket?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                if case .string(let text) = message, let data = text.data(using: .utf8) {
                    Task { @MainActor in
                        self.connected = true
                        self.handlePrice(data)
                        self.receivePriceLoop()
                    }
                } else {
                    Task { @MainActor in self.receivePriceLoop() }
                }
            case .failure:
                Task { @MainActor in
                    self.connected = false
                    try? await Task.sleep(nanoseconds: 3_000_000_000)
                    if self.priceSocket != nil { self.connectPrice() }
                }
            }
        }
    }

    private func handlePrice(_ data: Data) {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let payload = root["data"] as? [String: Any],
              let c = (payload["c"] as? String).flatMap(Double.init) else { return }
        price = c
        if !minuteCloses.isEmpty {
            minuteCloses[minuteCloses.count - 1] = c
            if let first = minuteCloses.first, first > 0 {
                changePct = (c - first) / first * 100
            }
        }
    }

    // MARK: - 청산 스트림 (OKX 공개)

    private func connectLiquidations() {
        guard let url = URL(string: "wss://ws.okx.com:8443/ws/v5/public") else { return }
        let task = session.webSocketTask(with: url)
        liqSocket = task
        task.resume()

        let sub = #"{"op":"subscribe","args":[{"channel":"liquidation-orders","instType":"SWAP"}]}"#
        task.send(.string(sub)) { _ in }
        receiveLiqLoop()

        // OKX는 30초 무통신 시 연결 종료 → 20초마다 ping
        okxPingTask?.cancel()
        okxPingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 20_000_000_000)
                guard let self else { return }
                self.liqSocket?.send(.string("ping")) { _ in }
            }
        }
    }

    private func receiveLiqLoop() {
        liqSocket?.receive { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let message):
                if case .string(let text) = message, text != "pong", let data = text.data(using: .utf8) {
                    Task { @MainActor in
                        self.liqConnected = true
                        self.handleLiquidation(data)
                        self.receiveLiqLoop()
                    }
                } else {
                    Task { @MainActor in self.receiveLiqLoop() }
                }
            case .failure:
                Task { @MainActor in
                    self.liqConnected = false
                    try? await Task.sleep(nanoseconds: 3_000_000_000)
                    if self.liqSocket != nil { self.connectLiquidations() }
                }
            }
        }
    }

    private func handleLiquidation(_ data: Data) {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let items = root["data"] as? [[String: Any]] else { return }
        for item in items {
            guard let instId = item["instId"] as? String, instId.hasPrefix(okxInstPrefix),
                  let details = item["details"] as? [[String: Any]] else { continue }
            for detail in details {
                guard let side = detail["side"] as? String,
                      let px = (detail["bkPx"] as? String).flatMap(Double.init),
                      let sz = (detail["sz"] as? String).flatMap(Double.init) else { continue }
                let event = LiquidationEvent(
                    time: Date(),
                    symbol: symbol,
                    isLongLiquidation: side == "sell", // 매도 체결로 청산 = 롱 청산
                    price: px,
                    usdValue: px * sz * contractValue
                )
                events.insert(event, at: 0)
                if events.count > 60 { events.removeLast() }
                if event.isLongLiquidation { longTotalUsd += event.usdValue } else { shortTotalUsd += event.usdValue }
                addToBucket(event)
            }
        }
    }

    private func addToBucket(_ event: LiquidationEvent) {
        let low = (event.price / bucketStep).rounded(.down) * bucketStep
        if let idx = buckets.firstIndex(where: { $0.priceLow == low }) {
            if event.isLongLiquidation { buckets[idx].longUsd += event.usdValue }
            else { buckets[idx].shortUsd += event.usdValue }
        } else {
            var bucket = LiquidationBucket(priceLow: low, priceHigh: low + bucketStep)
            if event.isLongLiquidation { bucket.longUsd = event.usdValue } else { bucket.shortUsd = event.usdValue }
            buckets.append(bucket)
            buckets.sort { $0.priceLow > $1.priceLow }
        }
    }
}
