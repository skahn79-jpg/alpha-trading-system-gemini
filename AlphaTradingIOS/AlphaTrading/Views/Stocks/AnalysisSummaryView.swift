import SwiftUI

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

    private func volumeText(_ v: Int?) -> String {
        guard let v else { return "-" }
        return v.formatted(.number.grouping(.automatic))
    }
}
