import SwiftUI

/// 특징 종목 — 상승 전환·바닥 신호가 뜬 종목만 모아서 표시
struct FeaturedSignalsView: View {
    @State private var response: FeaturedSignalsResponse?
    @State private var isLoading = true
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if isLoading {
                    LoadingView(message: "신호 스캔 중...")
                        .frame(maxWidth: .infinity, minHeight: 200)
                } else if let errorMessage {
                    Text(errorMessage)
                        .font(.paperlogy(14))
                        .foregroundStyle(AppTheme.down)
                        .padding()
                } else if let response {
                    if response.building == true {
                        VStack(spacing: 10) {
                            LoadingView(message: response.message ?? "첫 스캔 진행 중...")
                            Text("주요 종목을 순차 분석하고 있습니다. 잠시 후 아래로 당겨 새로고침하세요.")
                                .font(.paperlogy(12))
                                .foregroundStyle(AppTheme.textSecondary)
                                .multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity, minHeight: 200)
                    } else if response.results.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "binoculars")
                                .font(.largeTitle)
                                .foregroundStyle(AppTheme.textSecondary)
                            Text("현재 상승 전환·바닥 신호가 뜬 종목이 없습니다.")
                                .font(.paperlogy(14))
                                .foregroundStyle(AppTheme.textSecondary)
                        }
                        .frame(maxWidth: .infinity, minHeight: 200)
                    } else {
                        headerCard(response)
                        ForEach(response.results) { stock in
                            NavigationLink {
                                StockDetailView(stock: stock.asStock)
                            } label: {
                                stockCard(stock)
                            }
                        }
                        if let disclaimer = response.disclaimer {
                            Text(disclaimer)
                                .font(.paperlogy(10))
                                .foregroundStyle(AppTheme.textSecondary.opacity(0.8))
                                .padding(.horizontal, 4)
                        }
                    }
                }
            }
            .padding(16)
        }
        .background(AppTheme.background)
        .navigationTitle("특징 종목")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await load() }
        .task { await load() }
    }

    private func load() async {
        isLoading = response == nil
        errorMessage = nil
        do {
            response = try await APIClient.shared.get("/api/signals/featured") as FeaturedSignalsResponse
        } catch {
            errorMessage = "특징 종목을 불러오지 못했습니다: \(error.localizedDescription)"
        }
        isLoading = false
    }

    private func headerCard(_ response: FeaturedSignalsResponse) -> some View {
        HStack {
            Text("주요 \(response.scanned ?? 0)종목 중 \(response.count ?? response.results.count)개 신호 감지")
                .font(.paperlogy(13, weight: .medium))
                .foregroundStyle(AppTheme.textSecondary)
            Spacer()
            if response.refreshing == true {
                Text("갱신 중...")
                    .font(.paperlogy(11))
                    .foregroundStyle(AppTheme.accent)
            }
        }
        .padding(.horizontal, 4)
    }

    private func stockCard(_ stock: FeaturedStock) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(stock.kindLabel)
                    .font(.paperlogy(11, weight: .bold))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background((stock.kind == "turn" ? AppTheme.up : AppTheme.accent).opacity(0.2))
                    .foregroundStyle(stock.kind == "turn" ? AppTheme.up : AppTheme.accent)
                    .clipShape(Capsule())
                Text(stock.name)
                    .font(.paperlogy(16, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                Text(stock.code)
                    .font(.paperlogy(11))
                    .foregroundStyle(AppTheme.textSecondary)
                Spacer()
                if let score = stock.score {
                    Text("\(score)점")
                        .font(.paperlogy(13, weight: .bold))
                        .foregroundStyle(AppTheme.accent)
                }
                Image(systemName: "chevron.right")
                    .font(.caption)
                    .foregroundStyle(AppTheme.textSecondary)
            }
            ForEach(stock.reasons, id: \.self) { reason in
                Text("• \(reason)")
                    .font(.paperlogy(12))
                    .foregroundStyle(AppTheme.textPrimary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
