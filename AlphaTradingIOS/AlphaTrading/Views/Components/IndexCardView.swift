import SwiftUI

struct IndexCardView: View {
    let index: MarketIndex

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(index.name)
                .font(.paperlogy(14, weight: .medium))
                .foregroundStyle(AppTheme.textSecondary)
            Text(index.val)
                .font(.paperlogy(24, weight: .bold))
                .foregroundStyle(AppTheme.textPrimary)
            Text(index.ch)
                .font(.paperlogy(16, weight: .semibold))
                .foregroundStyle(index.up ? AppTheme.up : AppTheme.down)
            if let sub = index.sub {
                Text(sub)
                    .font(.paperlogy(12))
                    .foregroundStyle(AppTheme.textSecondary)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }
}
