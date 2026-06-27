import SwiftUI

struct StockRowView: View {
    let stock: Stock
    var quote: Quote?
    var showFavorite: Bool = false
    var isFavorite: Bool = false
    var onFavoriteToggle: (() -> Void)?

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(stock.name)
                    .font(.paperlogy(16, weight: .semibold))
                    .foregroundStyle(AppTheme.textPrimary)
                Text(stock.code)
                    .font(.paperlogy(12))
                    .foregroundStyle(AppTheme.textSecondary)
            }
            Spacer()
            if let quote {
                VStack(alignment: .trailing, spacing: 4) {
                    Text(quote.displayPrice)
                        .font(.paperlogy(16, weight: .semibold))
                        .foregroundStyle(AppTheme.textPrimary)
                    Text(quote.displayChange)
                        .font(.paperlogy(13))
                        .foregroundStyle(quote.isUp ? AppTheme.up : AppTheme.down)
                }
            }
            if showFavorite, let onFavoriteToggle {
                Button(action: onFavoriteToggle) {
                    Image(systemName: isFavorite ? "star.fill" : "star")
                        .foregroundStyle(isFavorite ? AppTheme.accent : AppTheme.textSecondary)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 16)
        .background(AppTheme.card)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }
}
