import SwiftUI
import Charts

/// 한국 수출입 리포트 — 월별 증감 추이 + 업종/종목 힌트 (투자 검토 참고용)
struct TradeReportView: View {
    @State private var report: TradeReport?
    @State private var picks: TradePicksResponse?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var viewMode = "monthly" // monthly | yearly

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                if isLoading {
                    LoadingView(message: "수출입 데이터 로딩...")
                        .frame(maxWidth: .infinity, minHeight: 200)
                } else if let errorMessage {
                    Text(errorMessage)
                        .font(.paperlogy(14))
                        .foregroundStyle(AppTheme.down)
                        .padding()
                } else if let report {
                    summaryCard(report)

                    Picker("보기", selection: $viewMode) {
                        Text("월별").tag("monthly")
                        Text("년도별").tag("yearly")
                    }
                    .pickerStyle(.segmented)

                    if viewMode == "monthly" {
                        trendChart(report)
                        monthsTable(report)
                    } else {
                        yearsChart(report)
                        yearsTable(report)
                    }

                    picksCard
                    sectorHintsCard(report)
                    if let disclaimer = report.disclaimer {
                        Text(disclaimer)
                            .font(.paperlogy(10))
                            .foregroundStyle(AppTheme.textSecondary.opacity(0.8))
                            .padding(.horizontal, 4)
                    }
                }
            }
            .padding(16)
        }
        .background(AppTheme.background)
        .navigationTitle("수출입 리포트")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
    }

    private func load() async {
        isLoading = report == nil
        errorMessage = nil
        do {
            report = try await APIClient.shared.get("/api/trade/report") as TradeReport
        } catch {
            errorMessage = "수출입 데이터를 불러오지 못했습니다: \(error.localizedDescription)"
        }
        // 저평가 후보는 부가 정보 — 실패해도 리포트를 막지 않음
        picks = try? await APIClient.shared.get("/api/trade/picks") as TradePicksResponse
        isLoading = false
    }

    // MARK: - 년도별

    private func yearsChart(_ report: TradeReport) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("연간 수출입 (백만 달러)")
                .font(.paperlogy(15, weight: .semibold))
                .foregroundStyle(AppTheme.textPrimary)
            if let years = report.years, !years.isEmpty {
                Chart(years) { y in
                    BarMark(x: .value("연도", y.year), y: .value("수출", y.exports))
                        .foregroundStyle(AppTheme.up.opacity(0.8))
                        .position(by: .value("구분", "수출"))
                    BarMark(x: .value("연도", y.year), y: .value("수입", y.imports))
                        .foregroundStyle(AppTheme.down.opacity(0.8))
                        .position(by: .value("구분", "수입"))
                }
                .chartXAxis {
                    AxisMarks { value in
                        AxisValueLabel {
                            if let raw = value.as(String.self) {
                                Text(String(raw.suffix(2)))
                                    .font(.paperlogy(9))
                            }
                        }
                    }
                }
                .frame(height: 180)
                HStack(spacing: 12) {
                    legendDot(color: AppTheme.up, label: "수출")
                    legendDot(color: AppTheme.down, label: "수입")
                    Spacer()
                }
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func yearsTable(_ report: TradeReport) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("연도별 실적 (전년 대비)")
                .font(.paperlogy(15, weight: .semibold))
                .foregroundStyle(AppTheme.textPrimary)
            ForEach((report.years ?? []).reversed()) { y in
                HStack {
                    Text(y.year + ((y.partial ?? false) ? "*" : ""))
                        .font(.paperlogy(13, weight: .medium))
                        .foregroundStyle(AppTheme.textPrimary)
                        .frame(width: 56, alignment: .leading)
                    Text("수출 \(y.exportsBillionText)")
                        .font(.paperlogy(12))
                        .foregroundStyle(AppTheme.textSecondary)
                    Text(y.balanceBillionText)
                        .font(.paperlogy(12))
                        .foregroundStyle(y.balance >= 0 ? AppTheme.up : AppTheme.down)
                    Spacer()
                    if let yoy = y.exportsYoY {
                        Text(String(format: "%+.1f%%", yoy))
                            .font(.paperlogy(13, weight: .bold))
                            .foregroundStyle(yoy >= 0 ? AppTheme.up : AppTheme.down)
                    }
                }
                .padding(.vertical, 2)
            }
            Text("* 진행 중인 연도 (누적)")
                .font(.paperlogy(9))
                .foregroundStyle(AppTheme.textSecondary.opacity(0.8))
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    // MARK: - AI 수출 연계 저평가 후보

    @ViewBuilder
    private var picksCard: some View {
        if let picks, !picks.results.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    Image(systemName: "brain.head.profile")
                        .foregroundStyle(AppTheme.accent)
                    Text("수출 연계 저평가 후보")
                        .font(.paperlogy(15, weight: .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                }
                if let basis = picks.basis {
                    Text(basis)
                        .font(.paperlogy(11))
                        .foregroundStyle(AppTheme.textSecondary)
                }
                ForEach(picks.results.prefix(8)) { pick in
                    NavigationLink {
                        StockDetailView(stock: pick.asStock)
                    } label: {
                        HStack(spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(pick.name)
                                    .font(.paperlogy(13, weight: .semibold))
                                    .foregroundStyle(AppTheme.textPrimary)
                                Text("\(pick.category ?? "-") · \(pick.sector ?? "-")")
                                    .font(.paperlogy(10))
                                    .foregroundStyle(AppTheme.textSecondary)
                            }
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text("PER \(pick.per.map { String(format: "%.1f", $0) } ?? "-") · PBR \(pick.pbr.map { String(format: "%.2f", $0) } ?? "-")")
                                    .font(.paperlogy(11))
                                    .foregroundStyle(AppTheme.textSecondary)
                                if let vs = pick.valueScore {
                                    Text("저평가 \(vs)점")
                                        .font(.paperlogy(11, weight: .bold))
                                        .foregroundStyle(AppTheme.accent)
                                }
                            }
                            Image(systemName: "chevron.right")
                                .font(.caption2)
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                        .padding(.vertical, 4)
                    }
                }
                if let disclaimer = picks.disclaimer {
                    Text(disclaimer)
                        .font(.paperlogy(9))
                        .foregroundStyle(AppTheme.textSecondary.opacity(0.7))
                }
            }
            .padding(16)
            .background(AppTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: 14))
        }
    }

    private func summaryCard(_ report: TradeReport) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(report.trendLabel)
                    .font(.paperlogy(13, weight: .bold))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(trendColor(report.trend).opacity(0.2))
                    .foregroundStyle(trendColor(report.trend))
                    .clipShape(Capsule())
                Spacer()
                if let source = report.source {
                    Text(source)
                        .font(.paperlogy(10))
                        .foregroundStyle(AppTheme.textSecondary)
                }
            }
            if let summary = report.summary {
                Text(summary)
                    .font(.paperlogy(14, weight: .medium))
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineSpacing(4)
            }
            if let latest = report.latest {
                HStack(spacing: 16) {
                    tradeStat("수출", latest.exportsBillionText, latest.exportsYoY)
                    tradeStat("수입", String(format: "%.1f억$", latest.imports / 100), latest.importsYoY)
                    tradeStat("무역수지", latest.balanceBillionText, nil)
                }
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func tradeStat(_ title: String, _ value: String, _ yoy: Double?) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title)
                .font(.paperlogy(11))
                .foregroundStyle(AppTheme.textSecondary)
            Text(value)
                .font(.paperlogy(15, weight: .bold))
                .foregroundStyle(AppTheme.textPrimary)
            if let yoy {
                Text(String(format: "전년比 %+.1f%%", yoy))
                    .font(.paperlogy(10))
                    .foregroundStyle(yoy >= 0 ? AppTheme.up : AppTheme.down)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func trendChart(_ report: TradeReport) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("월별 수출입 (백만 달러)")
                .font(.paperlogy(15, weight: .semibold))
                .foregroundStyle(AppTheme.textPrimary)
            if let months = report.months, !months.isEmpty {
                Chart {
                    ForEach(months) { m in
                        LineMark(x: .value("월", m.month), y: .value("수출", m.exports), series: .value("구분", "수출"))
                            .foregroundStyle(AppTheme.up)
                        LineMark(x: .value("월", m.month), y: .value("수입", m.imports), series: .value("구분", "수입"))
                            .foregroundStyle(AppTheme.down)
                    }
                }
                .chartYScale(domain: chartDomain(report))
                .chartXAxis {
                    AxisMarks(values: xLabels(report)) { value in
                        AxisGridLine()
                        AxisValueLabel {
                            if let raw = value.as(String.self) {
                                Text(String(raw.suffix(5)))
                                    .font(.paperlogy(9))
                            }
                        }
                    }
                }
                .frame(height: 180)
                HStack(spacing: 12) {
                    legendDot(color: AppTheme.up, label: "수출")
                    legendDot(color: AppTheme.down, label: "수입")
                    Spacer()
                }
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func legendDot(color: Color, label: String) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(label).font(.paperlogy(11)).foregroundStyle(AppTheme.textSecondary)
        }
    }

    private func chartDomain(_ report: TradeReport) -> ClosedRange<Double> {
        let values = (report.months ?? []).flatMap { [$0.exports, $0.imports] }
        guard let lo = values.min(), let hi = values.max(), lo < hi else { return 0...1 }
        let pad = (hi - lo) * 0.1
        return (lo - pad)...(hi + pad)
    }

    private func xLabels(_ report: TradeReport) -> [String] {
        let months = (report.months ?? []).map(\.month)
        guard months.count > 4 else { return months }
        let step = max(1, months.count / 4)
        return Swift.stride(from: 0, to: months.count, by: step).map { months[$0] }
    }

    private func monthsTable(_ report: TradeReport) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("월별 증감 (전년 동월 대비)")
                .font(.paperlogy(15, weight: .semibold))
                .foregroundStyle(AppTheme.textPrimary)
            ForEach((report.months ?? []).suffix(6).reversed()) { m in
                HStack {
                    Text(m.month)
                        .font(.paperlogy(13, weight: .medium))
                        .foregroundStyle(AppTheme.textPrimary)
                        .frame(width: 70, alignment: .leading)
                    Text(m.exportsBillionText)
                        .font(.paperlogy(12))
                        .foregroundStyle(AppTheme.textSecondary)
                    Spacer()
                    if let yoy = m.exportsYoY {
                        Text(String(format: "%+.1f%%", yoy))
                            .font(.paperlogy(13, weight: .bold))
                            .foregroundStyle(yoy >= 0 ? AppTheme.up : AppTheme.down)
                    }
                }
                .padding(.vertical, 2)
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func sectorHintsCard(_ report: TradeReport) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("품목 → 업종 참고 매핑")
                .font(.paperlogy(15, weight: .semibold))
                .foregroundStyle(AppTheme.textPrimary)
            Text("수출 주력 품목과 연관 업종입니다. 품목별 실적과 함께 종목 검토에 참고하세요.")
                .font(.paperlogy(11))
                .foregroundStyle(AppTheme.textSecondary)
            ForEach(report.sectorHints ?? []) { hint in
                HStack(alignment: .top, spacing: 10) {
                    Text(hint.category)
                        .font(.paperlogy(12, weight: .bold))
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(AppTheme.accent.opacity(0.15))
                        .foregroundStyle(AppTheme.accent)
                        .clipShape(Capsule())
                        .frame(width: 110, alignment: .leading)
                    VStack(alignment: .leading, spacing: 2) {
                        if let sector = hint.sector {
                            Text("업종: \(sector)")
                                .font(.paperlogy(12, weight: .medium))
                                .foregroundStyle(AppTheme.textPrimary)
                        }
                        if let note = hint.note {
                            Text(note)
                                .font(.paperlogy(10))
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                    }
                    Spacer()
                }
            }
            if let note = report.categoriesNote {
                Text(note)
                    .font(.paperlogy(10))
                    .foregroundStyle(AppTheme.textSecondary.opacity(0.8))
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func trendColor(_ trend: String?) -> Color {
        switch trend {
        case "increase": return AppTheme.up
        case "decrease": return AppTheme.down
        default: return AppTheme.accent
        }
    }
}
