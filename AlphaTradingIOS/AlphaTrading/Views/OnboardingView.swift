import SwiftUI

struct DisclaimerView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("투자 유의사항")
                    .font(.paperlogy(20, weight: .bold))
                    .foregroundStyle(AppTheme.accent)
                Text("""
                본 앱은 정보 제공 목적이며 투자 권유가 아닙니다.
                모든 투자 판단과 손실은 사용자 본인에게 있습니다.
                시세·AI 분석은 지연되거나 오류가 있을 수 있습니다.
                KIS API 및 서버 상태에 따라 일부 기능이 제한될 수 있습니다.
                """)
                .font(.paperlogy(14))
                .foregroundStyle(AppTheme.textSecondary)
                .lineSpacing(4)
            }
            .padding(20)
        }
    }
}

struct OnboardingView: View {
    @Binding var hasAcceptedDisclaimer: Bool

    var body: some View {
        ZStack {
            AppTheme.background.ignoresSafeArea()
            VStack(spacing: 24) {
                VStack(spacing: 8) {
                    Text("ALPHA TRADING")
                        .font(.paperlogy(28, weight: .bold))
                        .foregroundStyle(AppTheme.accent)
                    Text("iOS Native")
                        .font(.paperlogy(14))
                        .foregroundStyle(AppTheme.textSecondary)
                }
                DisclaimerView()
                    .background(AppTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .padding(.horizontal)
                Button {
                    hasAcceptedDisclaimer = true
                } label: {
                    Text("동의하고 시작하기")
                        .font(.paperlogy(16, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(AppTheme.accent)
                        .foregroundStyle(AppTheme.background)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .padding(.horizontal)
            }
            .padding(.vertical, 32)
        }
    }
}
