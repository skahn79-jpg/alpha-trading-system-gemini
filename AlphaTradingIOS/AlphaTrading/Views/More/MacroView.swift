import SwiftUI
import Charts

/// 거시경제 지표 — CPI·금리·연준 유동성·VIX·달러 (FRED 공개 데이터)
struct MacroView: View {
    @State private var report: MacroReport?
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if isLoading {
                    LoadingView(message: "거시 지표 로딩...")
                        .frame(maxWidth: .infinity, minHeight: 200)
                } else if let errorMessage {
                    Text(errorMessage)
                        .font(.paperlogy(14))
                        .foregroundStyle(AppTheme.down)
                        .padding()
                } else if let report {
                    moodCard(report)
                    ForEach(report.indicators ?? []) { indicator in
                        indicatorRow(indicator)
                    }
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
        .navigationTitle("거시 지표")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
    }

    private func load() async {
        isLoading = report == nil
        errorMessage = nil
        do {
            report = try await APIClient.shared.get("/api/macro/indicators") as MacroReport
        } catch {
            errorMessage = "거시 지표를 불러오지 못했습니다: \(error.localizedDescription)"
        }
        isLoading = false
    }

    private func moodCard(_ report: MacroReport) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("유동성 종합 판단")
                    .font(.paperlogy(12))
                    .foregroundStyle(AppTheme.textSecondary)
                Text(report.moodLabel ?? "-")
                    .font(.paperlogy(20, weight: .bold))
                    .foregroundStyle(moodColor(report.mood))
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 3) {
                Text("우호 \(report.supportive ?? 0)")
                    .font(.paperlogy(12, weight: .semibold))
                    .foregroundStyle(AppTheme.up)
                Text("부담 \(report.headwind ?? 0)")
                    .font(.paperlogy(12, weight: .semibold))
                    .foregroundStyle(AppTheme.down)
            }
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func indicatorRow(_ indicator: MacroIndicator) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(indicator.name)
                    .font(.paperlogy(14, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                if let note = indicator.note {
                    Text(note)
                        .font(.paperlogy(10))
                        .foregroundStyle(AppTheme.textSecondary)
                        .lineLimit(2)
                }
            }
            Spacer()

            if let spark = indicator.spark, spark.count > 2 {
                Chart(Array(spark.enumerated()), id: \.offset) { item in
                    LineMark(x: .value("i", item.offset), y: .value("v", item.element))
                        .foregroundStyle(stanceColor(indicator.stance))
                        .lineStyle(StrokeStyle(lineWidth: 1.5))
                }
                .chartXAxis(.hidden)
                .chartYAxis(.hidden)
                .chartYScale(domain: (spark.min() ?? 0)...(spark.max() ?? 1))
                .frame(width: 60, height: 28)
            }

            VStack(alignment: .trailing, spacing: 3) {
                Text("\(formatValue(indicator.value)) \(indicator.unit ?? "")")
                    .font(.paperlogy(15, weight: .bold))
                    .foregroundStyle(AppTheme.textPrimary)
                Text(indicator.stanceLabel)
                    .font(.paperlogy(10, weight: .bold))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(stanceColor(indicator.stance).opacity(0.2))
                    .foregroundStyle(stanceColor(indicator.stance))
                    .clipShape(Capsule())
            }
        }
        .padding(14)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func formatValue(_ v: Double) -> String {
        v == v.rounded() ? String(Int(v)) : String(format: "%.2f", v)
    }

    private func moodColor(_ mood: String?) -> Color {
        switch mood {
        case "risk_on": return AppTheme.up
        case "risk_off": return AppTheme.down
        default: return AppTheme.accent
        }
    }

    private func stanceColor(_ stance: String?) -> Color {
        switch stance {
        case "supportive": return AppTheme.up
        case "headwind": return AppTheme.down
        default: return AppTheme.accent
        }
    }
}
