import SwiftUI

enum AppTheme {
    static let background = Color(red: 0.027, green: 0.043, blue: 0.063)   // #070B10
    static let card = Color(red: 0.08, green: 0.10, blue: 0.14)
    static let accent = Color(red: 0.0, green: 0.851, blue: 1.0)           // #00D9FF
    static let up = Color(red: 0.0, green: 1.0, blue: 0.533)               // #00FF88
    static let down = Color(red: 1.0, green: 0.267, blue: 0.4)             // #FF4466
    static let textPrimary = Color.white
    static let textSecondary = Color.white.opacity(0.65)
    static let line = Color.white.opacity(0.12)
}

extension Font {
    static func paperlogy(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        let name: String
        switch weight {
        case .bold, .heavy, .black: name = "Paperlogy-7Bold"
        case .semibold: name = "Paperlogy-6SemiBold"
        case .medium: name = "Paperlogy-5Medium"
        case .light, .thin, .ultraLight: name = "Paperlogy-3Light"
        default: name = "Paperlogy-4Regular"
        }
        return .custom(name, size: size)
    }
}
