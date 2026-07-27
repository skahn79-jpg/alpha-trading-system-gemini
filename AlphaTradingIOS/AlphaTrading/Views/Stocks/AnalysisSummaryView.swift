import SwiftUI
import Charts

struct AnalysisSummaryView: View {
    let stock: Stock
    @ObservedObject var viewModel: AnalysisViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            if let sector = stock.sector {
                NavigationLink {
                    SectorBrowseView()
                } label: {
                    HStack {
                        Image(systemName: "square.grid.2x2")
                        Text("업종: \(sector)")
                            .font(.paperlogy(14, weight: .medium))
                        Spacer()
                        Text("동종목 보기")
                            .font(.paperlogy(12))
                            .foregroundStyle(AppTheme.accent)
                    }
                    .foregroundStyle(AppTheme.textPrimary)
                }
            }

            Text("펀더멘털")
                .font(.paperlogy(15, weight: .semibold))
                .foregroundStyle(AppTheme.textPrimary)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                KPICard(title: "PER", value: ratioText(viewModel.quote?.per), subtitle: nil)
                KPICard(title: "PBR", value: ratioText(viewModel.quote?.pbr), subtitle: nil)
                KPICard(title: "EPS", value: epsText(viewModel.quote?.eps), subtitle: nil)
                KPICard(title: "거래량", value: volumeText(viewModel.quote?.volume), subtitle: nil)
            }

            if stock.kind == .kr {
                FundamentalsCard(code: stock.code)
            }

            if !viewModel.sectorPeers.isEmpty {
                Text("동종 업종")
                    .font(.paperlogy(15, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(viewModel.sectorPeers.filter { $0.code != stock.code }.prefix(6)) { peer in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(peer.name)
                                    .font(.paperlogy(12, weight: .semibold))
                                    .lineLimit(1)
                                Text(peer.code)
                                    .font(.paperlogy(10))
                                    .foregroundStyle(AppTheme.textSecondary)
                            }
                            .foregroundStyle(AppTheme.textPrimary)
                            .padding(10)
                            .background(Color.black.opacity(0.2))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                    }
                }
            }

            Button {
                Task { await viewModel.runAIAnalysis(stock: stock) }
            } label: {
                Text(viewModel.isLoadingAI ? "AI 분석 중..." : "AI 빠른 분석")
                    .font(.paperlogy(15, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 12)
                    .background(AppTheme.accent)
                    .foregroundStyle(AppTheme.background)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }
            .disabled(viewModel.isLoadingAI)

            if let aiError = viewModel.aiError {
                Text(aiError)
                    .font(.paperlogy(12))
                    .foregroundStyle(AppTheme.down)
            }

            if !viewModel.aiSummary.isEmpty {
                Text(viewModel.aiSummary)
                    .font(.paperlogy(13))
                    .foregroundStyle(AppTheme.textPrimary)
                    .lineSpacing(5)
                    .padding(12)
                    .background(Color.black.opacity(0.2))
                    .clipShape(RoundedRectangle(cornerRadius: 10))
            }

            if let action = viewModel.analysis?.action {
                Text(action)
                    .font(.paperlogy(13, weight: .medium))
                    .foregroundStyle(AppTheme.accent)
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func ratioText(_ v: Double?) -> String {
        guard let v, v > 0 else { return "-" }
        return String(format: "%.2f", v)
    }

    private func epsText(_ v: Double?) -> String {
        guard let v else { return "-" }
        return Int(v).formatted(.number.grouping(.automatic))
    }

    private func volumeText(_ v: Double?) -> String {
        guard let v else { return "-" }
        return Int(v).formatted(.number.grouping(.automatic))
    }
}

// MARK: - Fundamentals (실적) Card

private struct FundamentalsResponse: Decodable {
    let ok: Bool?
    let code: String?
    let name: String?
    let unit: String?
    let years: [FundamentalYear]?
    let quarters: [FundamentalQuarter]?
    let fundamentalScore: Int?
    let fundamentalGrade: String?
    let note: String?
    let updatedAt: String?
}

private struct FundamentalYear: Decodable, Identifiable {
    let year: String?
    let revenue: Double?
    let op: Double?
    let revenueYoY: Double?
    let opYoY: Double?
    let opMargin: Double?

    var id: String { year ?? UUID().uuidString }
}

private struct FundamentalQuarter: Decodable, Identifiable {
    let label: String?
    let revenue: Double?
    let op: Double?

    var id: String { label ?? UUID().uuidString }
}

struct FundamentalsCard: View {
    let code: String

    @State private var data: FundamentalsResponse?
    @State private var didLoad = false

    private var years: [FundamentalYear] { data?.years ?? [] }
    private var quarters: [FundamentalQuarter] { data?.quarters ?? [] }
    private var hasContent: Bool { !years.isEmpty || !quarters.isEmpty }

    var body: some View {
        Group {
            if let data, hasContent {
                content(data)
            } else {
                // EmptyView에는 .task가 붙지 않아 요청 자체가 실행되지 않음 —
                // 높이 0의 실제 뷰를 두어 로딩 태스크가 항상 시작되게 함
                Color.clear.frame(height: 0)
            }
        }
        .task {
            guard !didLoad else { return }
            didLoad = true
            data = try? await APIClient.shared.get("/api/fundamentals/\(code)")
        }
    }

    @ViewBuilder
    private func content(_ data: FundamentalsResponse) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            header(data)

            if !years.isEmpty {
                yearsSection
            }

            if !quarters.isEmpty {
                quartersSection
            }

            footer(data)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.black.opacity(0.2))
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: Header

    private func header(_ data: FundamentalsResponse) -> some View {
        HStack(spacing: 8) {
            Text("실적 (3개년·최근 분기)")
                .font(.paperlogy(15, weight: .semibold))
                .foregroundStyle(AppTheme.textPrimary)
            Spacer()
            if let grade = data.fundamentalGrade, !grade.isEmpty {
                Text(grade)
                    .font(.paperlogy(13, weight: .bold))
                    .foregroundStyle(gradeColor(grade))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(gradeColor(grade).opacity(0.15))
                    .clipShape(Capsule())
            }
            if let score = data.fundamentalScore {
                Text("\(score)점")
                    .font(.paperlogy(12, weight: .semibold))
                    .foregroundStyle(AppTheme.textSecondary)
            }
        }
    }

    private func gradeColor(_ grade: String) -> Color {
        switch grade.uppercased() {
        case "A": return AppTheme.up
        case "B": return AppTheme.accent
        case "D": return AppTheme.down
        default:  return Color.gray
        }
    }

    // MARK: 3개년 섹션

    private var yearsSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("최근 3개년")
                .font(.paperlogy(12, weight: .medium))
                .foregroundStyle(AppTheme.textSecondary)

            Chart(years) { y in
                BarMark(
                    x: .value("연도", y.year ?? "-"),
                    y: .value("매출", y.revenue ?? 0)
                )
                .foregroundStyle(AppTheme.accent)
                .position(by: .value("항목", "매출"))

                BarMark(
                    x: .value("연도", y.year ?? "-"),
                    y: .value("영업이익", y.op ?? 0)
                )
                .foregroundStyle(AppTheme.up)
                .position(by: .value("항목", "영업이익"))
            }
            .chartXAxis {
                AxisMarks { value in
                    AxisValueLabel {
                        if let raw = value.as(String.self) {
                            Text(raw)
                                .font(.paperlogy(9))
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                    }
                }
            }
            .chartYAxis(.hidden)
            .frame(height: 130)

            HStack(spacing: 12) {
                legendDot(color: AppTheme.accent, label: "매출")
                legendDot(color: AppTheme.up, label: "영업이익")
                Spacer()
            }

            HStack(spacing: 0) {
                ForEach(years) { y in
                    VStack(spacing: 2) {
                        Text(shortYear(y.year))
                            .font(.paperlogy(9))
                            .foregroundStyle(AppTheme.textSecondary)
                        yoyText(y.opYoY)
                    }
                    .frame(maxWidth: .infinity)
                }
            }
        }
    }

    // MARK: 최근 4분기 섹션

    private var quartersSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("최근 분기")
                .font(.paperlogy(12, weight: .medium))
                .foregroundStyle(AppTheme.textSecondary)

            Chart(quarters) { q in
                BarMark(
                    x: .value("분기", q.label ?? "-"),
                    y: .value("매출", q.revenue ?? 0)
                )
                .foregroundStyle(AppTheme.accent)
                .position(by: .value("항목", "매출"))

                BarMark(
                    x: .value("분기", q.label ?? "-"),
                    y: .value("영업이익", q.op ?? 0)
                )
                .foregroundStyle(AppTheme.up)
                .position(by: .value("항목", "영업이익"))
            }
            .chartXAxis {
                AxisMarks { value in
                    AxisValueLabel {
                        if let raw = value.as(String.self) {
                            Text(raw)
                                .font(.paperlogy(9))
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                    }
                }
            }
            .chartYAxis(.hidden)
            .frame(height: 120)
        }
    }

    // MARK: Footer

    @ViewBuilder
    private func footer(_ data: FundamentalsResponse) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if let note = data.note, !note.isEmpty {
                Text(note)
                    .font(.paperlogy(11))
                    .foregroundStyle(AppTheme.textSecondary)
            }
            Text("단위: \(data.unit ?? "억원") · 출처 DART")
                .font(.paperlogy(10))
                .foregroundStyle(AppTheme.textSecondary.opacity(0.8))
        }
    }

    // MARK: Helpers

    private func legendDot(color: Color, label: String) -> some View {
        HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 8, height: 8)
            Text(label)
                .font(.paperlogy(10))
                .foregroundStyle(AppTheme.textSecondary)
        }
    }

    @ViewBuilder
    private func yoyText(_ yoy: Double?) -> some View {
        if let yoy {
            Text(String(format: "%+.1f%%", yoy))
                .font(.paperlogy(9, weight: .medium))
                .foregroundStyle(yoy >= 0 ? AppTheme.up : AppTheme.down)
        } else {
            Text("-")
                .font(.paperlogy(9))
                .foregroundStyle(AppTheme.textSecondary)
        }
    }

    private func shortYear(_ year: String?) -> String {
        guard let year else { return "-" }
        return year.count >= 2 ? String(year.suffix(2)) : year
    }
}
