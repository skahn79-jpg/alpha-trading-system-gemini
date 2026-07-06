import SwiftUI

struct AlertCenterView: View {
    @StateObject private var viewModel = AlertViewModel()
    @State private var showAdd = false
    @State private var newCode = "005930"
    @State private var newName = "삼성전자"
    @State private var newType: AlertType = .priceAbove
    @State private var newTarget = "80000"
    @State private var newMessage = ""
    @State private var searchQuery = ""
    @State private var searchResults: [MasterStock] = []

    var body: some View {
        List {
            Section {
                Button("알림 권한 요청") {
                    Task { await viewModel.requestNotificationPermission() }
                }
                Button("서버에서 동기화") {
                    Task { await viewModel.syncFromServer() }
                }
                .disabled(viewModel.isLoading)
            }

            if let error = viewModel.errorMessage {
                Text(error).foregroundStyle(AppTheme.down).font(.paperlogy(13))
            }

            Section("등록된 알림") {
                if viewModel.alerts.isEmpty {
                    Text("등록된 알림이 없습니다.")
                        .foregroundStyle(AppTheme.textSecondary)
                } else {
                    ForEach(viewModel.alerts) { alert in
                        VStack(alignment: .leading, spacing: 6) {
                            Text("\(alert.name) (\(alert.code))")
                                .font(.paperlogy(15, weight: .semibold))
                            Text("\(alert.type.label) · \(alert.target > 0 ? "\(Int(alert.target))원" : "20일선")")
                                .font(.paperlogy(13))
                                .foregroundStyle(AppTheme.accent)
                            if !alert.message.isEmpty {
                                Text(alert.message).font(.paperlogy(12)).foregroundStyle(AppTheme.textSecondary)
                            }
                        }
                        .swipeActions {
                            Button(role: .destructive) {
                                Task { await viewModel.removeAlert(alert) }
                            } label: {
                                Label("삭제", systemImage: "trash")
                            }
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(AppTheme.background)
        .navigationTitle("알림 센터")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showAdd = true } label: {
                    Image(systemName: "plus")
                }
            }
        }
        .sheet(isPresented: $showAdd) {
            NavigationStack {
                Form {
                    Section("종목 검색") {
                        TextField("종목명 또는 코드 검색 (예: 삼성전자)", text: $searchQuery)
                        ForEach(searchResults.prefix(6)) { stock in
                            Button {
                                newCode = stock.code
                                newName = stock.name
                                searchQuery = ""
                                searchResults = []
                            } label: {
                                HStack {
                                    Text(stock.name)
                                        .font(.paperlogy(14, weight: .medium))
                                        .foregroundStyle(AppTheme.textPrimary)
                                    Spacer()
                                    Text(stock.code)
                                        .font(.paperlogy(12))
                                        .foregroundStyle(AppTheme.textSecondary)
                                }
                            }
                        }
                    }
                    Section("선택된 종목") {
                        HStack {
                            Text(newName).font(.paperlogy(15, weight: .semibold))
                            Spacer()
                            Text(newCode).font(.paperlogy(13)).foregroundStyle(AppTheme.textSecondary)
                        }
                    }
                    Picker("조건", selection: $newType) {
                        ForEach(AlertType.allCases) { t in
                            Text(t.label).tag(t)
                        }
                    }
                    if newType != .ma20Touch {
                        TextField("목표가", text: $newTarget)
                            .keyboardType(.numberPad)
                    }
                    TextField("메모", text: $newMessage)
                }
                .navigationTitle("알림 추가")
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("취소") { showAdd = false }
                    }
                    ToolbarItem(placement: .confirmationAction) {
                        Button("저장") {
                            Task {
                                await viewModel.addAlert(
                                    code: newCode,
                                    name: newName,
                                    type: newType,
                                    target: Double(newTarget) ?? 0,
                                    message: newMessage
                                )
                                showAdd = false
                            }
                        }
                    }
                }
            }
            .presentationDetents([.large])
            .task(id: searchQuery) {
                let q = searchQuery.trimmingCharacters(in: .whitespaces)
                guard q.count >= 1 else { searchResults = []; return }
                try? await Task.sleep(nanoseconds: 300_000_000) // 타이핑 멈춤 대기
                guard !Task.isCancelled else { return }
                let response: MasterSearchResponse? = try? await APIClient.shared.get(
                    "/api/master/search",
                    query: [URLQueryItem(name: "q", value: q), URLQueryItem(name: "limit", value: "10")]
                )
                if !Task.isCancelled { searchResults = response?.results ?? [] }
            }
        }
        .task {
            await viewModel.requestNotificationPermission()
            await viewModel.syncFromServer()
        }
    }
}
