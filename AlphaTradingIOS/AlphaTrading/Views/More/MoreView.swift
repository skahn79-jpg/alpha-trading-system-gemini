import SwiftUI

struct MoreView: View {
    @EnvironmentObject var auth: AdminAuthViewModel
    @State private var showLogoutConfirm = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 12) {
                    apiInfoCard

                    userCard

                    NavigationLink {
                        BrokerStatusView()
                    } label: {
                        moreRow(icon: "building.columns.circle.fill", title: "KB증권", subtitle: "연결 상태 · 조회 준비 중")
                    }

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
                        LiveLiquidationView()
                    } label: {
                        moreRow(icon: "bolt.horizontal.circle.fill", title: "실시간 청산 모니터", subtitle: "BTC/ETH 실시간 가격 · 청산 피드 · 분포")
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
            .floatingTabBarContentInset()
            .background(AppTheme.background)
            .navigationTitle("더보기")
            .alert("로그아웃", isPresented: $showLogoutConfirm) {
                Button("취소", role: .cancel) {}
                Button("로그아웃", role: .destructive) {
                    Task { await auth.logout() }
                }
            } message: {
                Text("로그아웃하면 다시 로그인해야 합니다.")
            }
        }
    }

    private var userCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("로그인 사용자: \(auth.displayName)")
                .font(.paperlogy(15, weight: .semibold))
                .foregroundStyle(AppTheme.textPrimary)
            Button {
                showLogoutConfirm = true
            } label: {
                Text("로그아웃")
                    .font(.paperlogy(15, weight: .medium))
                    .foregroundStyle(AppTheme.down)
            }
            .accessibilityLabel("로그아웃")
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private var apiInfoCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(MoreScreenCopy.serviceTitle)
                    .font(.paperlogy(14, weight: .medium))
                    .foregroundStyle(AppTheme.textSecondary)
                Spacer()
                Text(MoreScreenCopy.serviceStatus)
                    .font(.paperlogy(13, weight: .medium))
                    .foregroundStyle(AppTheme.accent)
            }
            HStack {
                Text(MoreScreenCopy.securityTitle)
                    .font(.paperlogy(14, weight: .medium))
                    .foregroundStyle(AppTheme.textSecondary)
                Spacer()
                Text(MoreScreenCopy.securityStatus)
                    .font(.paperlogy(13, weight: .medium))
                    .foregroundStyle(AppTheme.accent)
            }
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

enum MoreScreenCopy {
    static let serviceTitle = "서비스 연결"
    static let serviceStatus = "정상"
    static let securityTitle = "보안 연결"
    static let securityStatus = "정상"
}
