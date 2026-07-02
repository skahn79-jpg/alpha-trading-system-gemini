import SwiftUI

struct MoreView: View {
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    apiInfoCard

                    NavigationLink {
                        FeaturedSignalsView()
                    } label: {
                        moreRow(icon: "sparkle.magnifyingglass", title: "특징 종목", subtitle: "상승 전환 · 바닥 신호 자동 감지")
                    }

                    NavigationLink {
                        ScreenerView()
                    } label: {
                        moreRow(icon: "chart.bar.doc.horizontal", title: "스크리너", subtitle: "KOSPI/KOSDAQ AI 점수 랭킹")
                    }

                    NavigationLink {
                        GlobalMarketView()
                    } label: {
                        moreRow(icon: "globe.americas.fill", title: "US / CRYPTO", subtitle: "미국주식 · 암호화폐 실시간 시세")
                    }

                    NavigationLink {
                        CryptoReportView()
                    } label: {
                        moreRow(icon: "bitcoinsign.circle.fill", title: "크립토 리포트", subtitle: "BTC/ETH 차트분석 · 업황 · CLARITY 법안 관찰")
                    }

                    NavigationLink {
                        AlertCenterView()
                    } label: {
                        moreRow(icon: "bell.badge.fill", title: "알림 센터", subtitle: "가격 · 20일선 알림 + Telegram 연동")
                    }

                    NavigationLink {
                        AIReportView()
                    } label: {
                        moreRow(icon: "sparkles", title: "AI 리포트", subtitle: "Gemini 기반 시장 분석 채팅")
                    }

                    NavigationLink {
                        TradeReportView()
                    } label: {
                        moreRow(icon: "shippingbox.fill", title: "수출입 리포트", subtitle: "한국 월별 수출입 증감 · 업종 힌트")
                    }

                    NavigationLink {
                        MacroView()
                    } label: {
                        moreRow(icon: "building.columns.fill", title: "거시 지표", subtitle: "CPI · 금리 · 연준 유동성 · VIX")
                    }

                    NavigationLink {
                        SectorBrowseView()
                    } label: {
                        moreRow(icon: "square.grid.2x2", title: "업종별 종목 검색", subtitle: "코스피 · 코스닥 업종 탐색")
                    }

                    DisclaimerView()
                        .padding(16)
                        .background(AppTheme.card)
                        .clipShape(RoundedRectangle(cornerRadius: 14))
                }
                .padding(16)
            }
            .background(AppTheme.background)
            .navigationTitle("더보기")
        }
    }

    private var apiInfoCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("API 서버")
                .font(.paperlogy(14, weight: .medium))
                .foregroundStyle(AppTheme.textSecondary)
            Text(APIConfig.baseURL.absoluteString)
                .font(.paperlogy(13))
                .foregroundStyle(AppTheme.accent)
            Text("설정 소스: 웹앱 .env.local → Generated.xcconfig")
                .font(.paperlogy(11))
                .foregroundStyle(AppTheme.textSecondary)
            Text("보안: TLS + 호스트 검증 + Keychain API Key")
                .font(.paperlogy(11))
                .foregroundStyle(AppTheme.textSecondary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func moreRow(icon: String, title: String, subtitle: String) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon)
                .font(.title2)
                .foregroundStyle(AppTheme.accent)
                .frame(width: 36)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.paperlogy(16, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                Text(subtitle)
                    .font(.paperlogy(12))
                    .foregroundStyle(AppTheme.textSecondary)
            }
            Spacer()
            Image(systemName: "chevron.right")
                .foregroundStyle(AppTheme.textSecondary)
        }
        .padding(16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}
