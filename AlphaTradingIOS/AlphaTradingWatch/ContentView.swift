import SwiftUI

struct ContentView: View {
    @ObservedObject private var inbox = WatchSignalInbox.shared

    var body: some View {
        NavigationStack {
            Group {
                if inbox.signals.isEmpty {
                    VStack(spacing: 8) {
                        Image(systemName: "bell.slash")
                            .font(.title2)
                        Text("아이폰에서 관심종목 알림을 기다립니다")
                            .multilineTextAlignment(.center)
                            .font(.footnote)
                        Text(WatchComplicationSnapshot.detail(inbox.signals))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .padding()
                } else {
                    List(inbox.signals) { signal in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(signal.kind.label)
                                    .font(.caption2.bold())
                                    .foregroundStyle(signal.opportunity ? Color.green : Color.red)
                                Spacer()
                                Text(signal.opportunity ? "기회" : "위험")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            Text(signal.title)
                                .font(.headline)
                            Text(signal.detail)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(3)
                        }
                    }
                }
            }
            .navigationTitle("위험·기회")
        }
        .onAppear { inbox.activate() }
    }
}

#Preview {
    ContentView()
}
