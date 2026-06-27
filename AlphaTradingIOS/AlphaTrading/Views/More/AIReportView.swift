import SwiftUI

struct AIReportView: View {
    @State private var prompt = "오늘 국내 증시 핵심 이슈와 섹터별 흐름을 5문장으로 요약해주세요."
    @State private var result = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var history: [AIChatMessage] = []

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    ForEach(history) { msg in
                        AIChatBubble(message: msg)
                    }
                    if !result.isEmpty && history.isEmpty {
                        Text(result)
                            .font(.paperlogy(14))
                            .foregroundStyle(AppTheme.textPrimary)
                            .padding()
                            .background(AppTheme.card)
                            .clipShape(RoundedRectangle(cornerRadius: 12))
                    }
                    if let errorMessage {
                        Text(errorMessage)
                            .foregroundStyle(AppTheme.down)
                            .font(.paperlogy(13))
                    }
                }
                .padding()
            }

            Divider().overlay(AppTheme.line)

            HStack(alignment: .bottom, spacing: 8) {
                TextField("질문 입력...", text: $prompt, axis: .vertical)
                    .lineLimit(1...4)
                    .padding(10)
                    .background(AppTheme.card)
                    .clipShape(RoundedRectangle(cornerRadius: 10))
                Button {
                    Task { await send() }
                } label: {
                    Image(systemName: isLoading ? "hourglass" : "paperplane.fill")
                        .foregroundStyle(AppTheme.background)
                        .padding(10)
                        .background(AppTheme.accent)
                        .clipShape(Circle())
                }
                .disabled(isLoading || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            .padding()
            .background(AppTheme.background)
        }
        .background(AppTheme.background)
        .navigationTitle("AI 리포트")
    }

    private func send() async {
        let text = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        isLoading = true
        errorMessage = nil
        history.append(AIChatMessage(role: .user, text: text))
        prompt = ""
        defer { isLoading = false }

        do {
            let body = AIAnalyzeRequest(
                prompt: text,
                systemPrompt: "한국 주식 시장 전문 애널리스트처럼 한국어로 답변하세요. 투자 권유는 하지 마세요.",
                maxTokens: 1200
            )
            let response: AIAnalyzeResponse = try await APIClient.shared.post("/api/ai/analyze", body: body)
            if response.ok, let reply = response.text {
                result = reply
                history.append(AIChatMessage(role: .assistant, text: reply))
            } else {
                errorMessage = response.error ?? "AI 응답 실패"
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct AIChatMessage: Identifiable {
    enum Role { case user, assistant }
    let id = UUID()
    let role: Role
    let text: String
}

private struct AIChatBubble: View {
    let message: AIChatMessage

    var body: some View {
        HStack {
            if message.role == .user { Spacer(minLength: 40) }
            Text(message.text)
                .font(.paperlogy(14))
                .foregroundStyle(message.role == .user ? AppTheme.background : AppTheme.textPrimary)
                .padding(12)
                .background(message.role == .user ? AppTheme.accent : AppTheme.card)
                .clipShape(RoundedRectangle(cornerRadius: 14))
            if message.role == .assistant { Spacer(minLength: 40) }
        }
    }
}
