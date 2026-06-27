import SwiftUI

struct LoadingView: View {
    var message: String = "불러오는 중..."

    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
                .tint(AppTheme.accent)
            Text(message)
                .font(.paperlogy(14))
                .foregroundStyle(AppTheme.textSecondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppTheme.background)
    }
}
